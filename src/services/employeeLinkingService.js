import { AccessRequest } from '../models/AccessRequest.js';
import { Company } from '../models/Company.js';
import { CompanyEmployeeInvitation } from '../models/CompanyEmployeeInvitation.js';
import { ActivityLog } from '../models/ActivityLog.js';
import { EmployeeProfile } from '../models/EmployeeProfile.js';
import { ApiError } from '../utils/ApiError.js';
import { assertValidObjectId } from '../utils/objectId.js';
import {
  acceptInvitationInternal,
  linkPendingInvitationsToUser,
} from './invitationService.js';
import {
  writeAccessAuditFromEmployee,
  writeInvitationAuditFromEmployee,
} from './companyLinkingService.js';
import { ACCESS_LABELS } from './employeeAccessService.js';

async function findInvitationForEmployee(userId, invitationId) {
  const validId = assertValidObjectId(invitationId, 'invitation id');
  await linkPendingInvitationsToUser(userId);

  let invitation = await CompanyEmployeeInvitation.findOne({
    _id: validId,
    employeeId: userId,
  });

  if (!invitation) {
    const profile = await EmployeeProfile.findOne({ userId }).select('email phone veriworkId');
    const matchers = [
      ...(profile?.email ? [{ employeeEmail: profile.email.toLowerCase() }] : []),
      ...(profile?.phone ? [{ employeeMobile: profile.phone }] : []),
      ...(profile?.veriworkId ? [{ employeeVeriworkId: profile.veriworkId }] : []),
    ];
    if (matchers.length) {
      invitation = await CompanyEmployeeInvitation.findOne({
        _id: validId,
        status: 'pending',
        $or: matchers,
      });
      if (invitation && !invitation.employeeId) {
        invitation.employeeId = userId;
        await invitation.save();
      }
    }
  }

  if (!invitation) throw ApiError.notFound('Invitation not found');
  return invitation;
}

function mapInvitation(invitation, companyName) {
  return {
    id: invitation._id,
    invitationId: invitation._id,
    companyName,
    department: invitation.department,
    designation: invitation.designation,
    status: invitation.status,
    dashboardStatus: invitation.status === 'pending' ? 'Invitation Sent' : invitation.status,
  };
}

export async function listEmployeeInvitations(userId) {
  await linkPendingInvitationsToUser(userId);

  const invitations = await CompanyEmployeeInvitation.find({
    employeeId: userId,
    status: { $in: ['pending', 'accepted', 'rejected', 'expired'] },
  }).sort({ createdAt: -1 });

  const companyIds = [...new Set(invitations.map((i) => i.companyId.toString()))];
  const companies = await Company.find({ _id: { $in: companyIds } }).select('name');
  const companyMap = new Map(companies.map((company) => [company._id.toString(), company.name]));

  return invitations.map((invitation) => mapInvitation(invitation, companyMap.get(invitation.companyId.toString()) || ''));
}

export async function acceptInvitation(userId, invitationId) {
  const invitation = await findInvitationForEmployee(userId, invitationId);
  if (invitation.status !== 'pending') {
    throw ApiError.badRequest('Only pending invitations can be accepted');
  }

  await acceptInvitationInternal(invitation, userId);

  return {
    id: invitation._id,
    invitationId: invitation._id,
    status: 'accepted',
    dashboardStatus: 'Linked Employee',
    respondedAt: invitation.respondedAt,
  };
}

export async function rejectInvitation(userId, invitationId) {
  const invitation = await findInvitationForEmployee(userId, invitationId);
  if (invitation.status !== 'pending') {
    throw ApiError.badRequest('Only pending invitations can be rejected');
  }

  invitation.status = 'rejected';
  invitation.respondedAt = new Date();
  await invitation.save();

  await writeInvitationAuditFromEmployee(invitation, 'invitation_rejected');

  return {
    id: invitation._id,
    invitationId: invitation._id,
    status: invitation.status,
    respondedAt: invitation.respondedAt,
  };
}

function normalizeAccessStatus(status) {
  if (status === 'accepted') return 'approved';
  return status;
}

function mapAccessRequest(request, companyName) {
  return {
    id: request._id,
    companyId: request.companyId,
    companyName,
    requestType: request.requestType,
    requestTypeLabel: ACCESS_LABELS[request.requestType] || request.requestType,
    message: request.message || '',
    status: normalizeAccessStatus(request.status),
    requestedAt: request.requestedAt || request.createdAt,
    respondedAt: request.respondedAt,
  };
}

export async function listEmployeeAccessRequests(userId) {
  const requests = await AccessRequest.find({
    $or: [{ employeeId: userId }, { employeeUserId: userId }],
  }).sort({ createdAt: -1 });

  const companyIds = [...new Set(requests.map((request) => request.companyId.toString()))];
  const companies = await Company.find({ _id: { $in: companyIds } }).select('name');
  const companyMap = new Map(companies.map((company) => [company._id.toString(), company.name]));

  return requests.map((request) => mapAccessRequest(request, companyMap.get(request.companyId.toString()) || ''));
}

async function updateAccessRequestStatus(userId, requestId, status) {
  const validId = assertValidObjectId(requestId, 'access request id');
  const request = await AccessRequest.findOne({
    _id: validId,
    $or: [{ employeeId: userId }, { employeeUserId: userId }],
  });
  if (!request) throw ApiError.notFound('Access request not found');

  const currentStatus = normalizeAccessStatus(request.status);

  // Approving is only valid from a pending request.
  if (status === 'approved' && currentStatus !== 'pending') {
    throw ApiError.badRequest('Access request already processed');
  }

  // Rejecting a pending request declines it; rejecting an approved request
  // revokes previously granted access ("Remove access"). Anything already
  // rejected cannot be processed again.
  const isRevoke = status === 'rejected' && currentStatus === 'approved';
  if (status === 'rejected' && currentStatus !== 'pending' && !isRevoke) {
    throw ApiError.badRequest('Access request already processed');
  }

  request.status = status;
  request.respondedAt = new Date();
  await request.save();

  await ActivityLog.findOneAndUpdate(
    {
      userId,
      'metadata.accessRequestId': request._id.toString(),
      type: { $in: ['access_request', 'consent_request'] },
    },
    { status: status === 'approved' ? 'approved' : 'denied' },
  );

  const auditAction = status === 'approved'
    ? 'access_request_approved'
    : isRevoke
      ? 'access_request_revoked'
      : 'access_request_rejected';
  await writeAccessAuditFromEmployee(request, auditAction);

  return {
    id: request._id,
    status: request.status,
    respondedAt: request.respondedAt,
  };
}

export async function approveEmployeeAccessRequest(userId, requestId) {
  return updateAccessRequestStatus(userId, requestId, 'approved');
}

export async function rejectEmployeeAccessRequest(userId, requestId) {
  return updateAccessRequestStatus(userId, requestId, 'rejected');
}
