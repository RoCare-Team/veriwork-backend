import crypto from 'crypto';
import { Company } from '../models/Company.js';
import { CompanyEmployee } from '../models/CompanyEmployee.js';
import { CompanyEmployeeInvitation } from '../models/CompanyEmployeeInvitation.js';
import { EmployeeProfile } from '../models/EmployeeProfile.js';
import { ActivityLog } from '../models/ActivityLog.js';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { CompanyAuditLog } from '../models/CompanyAuditLog.js';
import { sendEmployeeInvitationEmail } from './emailService.js';

const INVITATION_TOKEN_DAYS = 14;

async function writeInvitationAudit(invitation, userId, autoJoined = false) {
  await CompanyAuditLog.create({
    companyId: invitation.companyId,
    actorUserId: userId,
    employeeId: userId,
    action: 'invitation_accepted',
    entityType: 'company_employee_invitation',
    entityId: String(invitation._id),
    metadata: { autoJoined, department: invitation.department },
  });
}

export function generateRegistrationToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function buildEmployeeJoinLink(token) {
  const base = env.frontendUrl.replace(/\/$/, '');
  return `${base}/employee/join?token=${token}`;
}

export async function acceptInvitationInternal(invitation, userId) {
  invitation.status = 'accepted';
  invitation.employeeId = userId;
  invitation.respondedAt = new Date();
  await invitation.save();

  await CompanyEmployee.findOneAndUpdate(
    { companyId: invitation.companyId, employeeId: userId },
    {
      companyId: invitation.companyId,
      employeeId: userId,
      employeeName: invitation.employeeName || '',
      department: invitation.department,
      designation: invitation.designation,
      employmentStatus: 'active',
      onboardingStage: 'pending_verification',
      joinedAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  await writeInvitationAudit(invitation, userId, Boolean(invitation.autoJoinOnSetup));

  return invitation;
}

export async function getPublicInvitationByToken(token) {
  if (!token?.trim()) throw ApiError.badRequest('Invitation token is required');

  const invitation = await CompanyEmployeeInvitation.findOne({
    registrationToken: token,
    status: { $in: ['pending', 'pending_registration'] },
  });

  if (!invitation) throw ApiError.notFound('Invitation link is invalid or expired');

  if (invitation.registrationTokenExpiresAt && invitation.registrationTokenExpiresAt < new Date()) {
    throw ApiError.badRequest('Invitation link has expired');
  }

  const company = await Company.findById(invitation.companyId).select('name');

  return {
    invitationId: invitation._id,
    employeeName: invitation.employeeName,
    employeeEmail: invitation.employeeEmail,
    employeeMobile: invitation.employeeMobile,
    department: invitation.department,
    designation: invitation.designation,
    companyName: company?.name || 'Company',
    status: invitation.status,
    requiresRegistration: invitation.status === 'pending_registration',
    autoJoinOnSetup: invitation.autoJoinOnSetup,
  };
}

export async function linkPendingInvitationsToUser(userId) {
  const profile = await EmployeeProfile.findOne({ userId }).select('email phone veriworkId');
  if (!profile) return [];

  const matchers = [
    ...(profile.email ? [{ employeeEmail: profile.email.toLowerCase() }] : []),
    ...(profile.phone ? [{ employeeMobile: profile.phone }] : []),
    ...(profile.veriworkId ? [{ employeeVeriworkId: profile.veriworkId }] : []),
  ];
  if (!matchers.length) return [];

  const pendingRegistration = await CompanyEmployeeInvitation.find({
    employeeId: null,
    status: 'pending_registration',
    $or: matchers,
  });

  await Promise.all(
    pendingRegistration.map(async (invitation) => {
      invitation.employeeId = userId;
      if (!invitation.autoJoinOnSetup) {
        invitation.status = 'pending';
      }
      await invitation.save();
    }),
  );

  return pendingRegistration;
}

export async function autoJoinAfterProfileSetup(userId, { invitationToken } = {}) {
  await linkPendingInvitationsToUser(userId);

  const profile = await EmployeeProfile.findOne({ userId });
  if (!profile?.profileSetupComplete) {
    return { autoJoined: [], pendingAccept: [] };
  }

  const toProcess = [];

  if (invitationToken) {
    const byToken = await CompanyEmployeeInvitation.findOne({
      registrationToken: invitationToken,
      status: { $in: ['pending', 'pending_registration'] },
    });
    if (byToken) {
      if (profile.email && byToken.employeeEmail
        && profile.email.toLowerCase() !== byToken.employeeEmail.toLowerCase()) {
        throw ApiError.badRequest('Profile email does not match invitation email');
      }
      byToken.employeeId = userId;
      toProcess.push(byToken);
    }
  }

  const autoJoinInvitations = await CompanyEmployeeInvitation.find({
    employeeId: userId,
    status: { $in: ['pending', 'pending_registration'] },
    autoJoinOnSetup: true,
  });

  for (const inv of autoJoinInvitations) {
    if (!toProcess.find((i) => i._id.equals(inv._id))) {
      toProcess.push(inv);
    }
  }

  const autoJoined = [];
  for (const invitation of toProcess) {
    if (!invitation.autoJoinOnSetup) continue;
    if (invitation.status === 'accepted') continue;

    await acceptInvitationInternal(invitation, userId);
    autoJoined.push({
      invitationId: invitation._id,
      companyId: invitation.companyId,
      department: invitation.department,
      designation: invitation.designation,
    });
  }

  const pendingAccept = await CompanyEmployeeInvitation.find({
    employeeId: userId,
    status: 'pending',
    autoJoinOnSetup: false,
  }).select('_id companyId department designation');

  return { autoJoined, pendingAccept };
}

export async function sendInvitationNotifications({
  invitation,
  companyName,
  employeeName,
  isRegistered,
}) {
  const joinLink = isRegistered
    ? `${env.frontendUrl.replace(/\/$/, '')}/employee/invitations`
    : buildEmployeeJoinLink(invitation.registrationToken);

  let emailResult = { sent: false, mock: true };
  if (invitation.employeeEmail) {
    emailResult = await sendEmployeeInvitationEmail({
      to: invitation.employeeEmail,
      employeeName: employeeName || invitation.employeeName,
      companyName,
      department: invitation.department,
      designation: invitation.designation,
      joinLink,
      isRegistered,
    });
  }

  if (isRegistered && invitation.employeeId) {
    await ActivityLog.create({
      userId: invitation.employeeId,
      type: 'system',
      title: 'Company invitation received',
      message: `${companyName} wants to add you to their workforce as ${invitation.designation || 'a team member'}${invitation.department ? ` in ${invitation.department}` : ''}. Open Invitations to accept or decline.`,
      company: companyName,
      status: 'pending',
      metadata: {
        invitationId: invitation._id.toString(),
        department: invitation.department || '',
        designation: invitation.designation || '',
        event: 'company_invitation',
      },
    });
  }

  return {
    emailSent: emailResult.sent || emailResult.mock,
    emailMock: emailResult.mock,
    joinLink: emailResult.joinLink || joinLink,
  };
}
