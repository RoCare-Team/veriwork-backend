import { AccessRequest } from '../models/AccessRequest.js';
import { Company } from '../models/Company.js';
import { CompanyEmployee } from '../models/CompanyEmployee.js';
import { EmployeeProfile } from '../models/EmployeeProfile.js';
import { JoinRequest } from '../models/JoinRequest.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { createActivity } from './activityService.js';

function getCompanyId(user) {
  if (!user.companyId) throw ApiError.badRequest('No company associated with this account');
  return user.companyId;
}

const REQUEST_TYPE_LABELS = {
  profile_access: 'Profile access request',
  background_check: 'Background check consent',
  verification_data: 'Verification data request',
};

function mapStatusForResponse(status) {
  return status === 'accepted' ? 'approved' : status;
}

function buildSummary(requests) {
  return {
    total: requests.length,
    accepted: requests.filter((r) => mapStatusForResponse(r.status) === 'approved').length,
    pending: requests.filter((r) => r.status === 'pending').length,
    rejected: requests.filter((r) => r.status === 'rejected').length,
  };
}

function formatRequest(request, companyName) {
  return {
    id: request._id,
    employeeUserId: request.employeeUserId,
    employeeName: request.employeeName,
    company: companyName,
    requestType: request.requestType,
    message: request.message,
    dateRequested: request.createdAt,
    status: mapStatusForResponse(request.status),
    respondedAt: request.respondedAt,
  };
}

export async function createAccessRequest(user, data) {
  const companyId = getCompanyId(user);
  const requestType = data.requestType || 'profile_access';

  const [company, employeeUser, profile, workforceMember, companyEmployee] = await Promise.all([
    Company.findById(companyId),
    User.findById(data.employeeUserId),
    EmployeeProfile.findOne({ userId: data.employeeUserId }),
    JoinRequest.findOne({
      companyId,
      candidateUserId: data.employeeUserId,
      status: 'approved',
    }),
    CompanyEmployee.findOne({ companyId, employeeId: data.employeeUserId }),
  ]);

  if (!company) throw ApiError.notFound('Company not found');
  if (!employeeUser || employeeUser.role !== 'employee') {
    throw ApiError.badRequest('Invalid employee user');
  }
  if (!workforceMember && !companyEmployee) {
    throw ApiError.badRequest('Employee is not part of your approved workforce');
  }

  const existingPending = await AccessRequest.findOne({
    companyId,
    employeeUserId: data.employeeUserId,
    requestType,
    status: 'pending',
  });

  if (existingPending) {
    throw ApiError.conflict('A pending request of this type already exists for this employee');
  }

  const employeeName = profile?.name || workforceMember?.name || '';
  const title = REQUEST_TYPE_LABELS[requestType] || 'Access request';
  const message = data.message
    || `${company.name} requested access to your profile information`;

  const activity = await createActivity(data.employeeUserId, {
    type: requestType === 'background_check' ? 'consent_request' : 'access_request',
    title,
    message,
    company: company.name,
    status: 'pending',
    metadata: {
      companyId: companyId.toString(),
      requestType,
    },
  });

  const accessRequest = await AccessRequest.create({
    companyId,
    requestedBy: user._id,
    employeeId: data.employeeUserId,
    employeeUserId: data.employeeUserId,
    employeeName,
    requestType,
    message: data.message || '',
    status: 'pending',
    activityLogId: activity._id,
    metadata: {
      requestType,
    },
  });

  activity.metadata = {
    ...activity.metadata,
    accessRequestId: accessRequest._id.toString(),
  };
  await activity.save();

  return formatRequest(accessRequest, company.name);
}

export async function listAccessRequests(user, query = {}) {
  const companyId = getCompanyId(user);
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter = { companyId };
  if (query.status && query.status !== 'all') {
    filter.status = query.status === 'approved' ? { $in: ['approved', 'accepted'] } : query.status;
  }

  const [company, allRequests, requests] = await Promise.all([
    Company.findById(companyId).select('name'),
    AccessRequest.find({ companyId }).sort({ createdAt: -1 }),
    AccessRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
  ]);

  const companyName = company?.name || '';
  const total = await AccessRequest.countDocuments(filter);

  return {
    summary: buildSummary(allRequests),
    requests: requests.map((request) => formatRequest(request, companyName)),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

export async function getAccessRequest(user, requestId) {
  const companyId = getCompanyId(user);
  const [company, request] = await Promise.all([
    Company.findById(companyId).select('name'),
    AccessRequest.findOne({ _id: requestId, companyId }),
  ]);

  if (!request) throw ApiError.notFound('Access request not found');

  return formatRequest(request, company?.name || '');
}
