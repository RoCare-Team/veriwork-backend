import { Company } from '../models/Company.js';
import { JobExperience } from '../models/JobExperience.js';
import { VerificationRequest } from '../models/VerificationRequest.js';
import { ApiError } from '../utils/ApiError.js';
import { assertValidObjectId } from '../utils/objectId.js';
import { createCompanyAuditLog } from './companyLinkingService.js';
import { CompanyEmployee } from '../models/CompanyEmployee.js';
import { refreshCachedScore } from './employeeProfileService.js';

function requireCompanyId(user) {
  if (!user.companyId) throw ApiError.forbidden('No company associated with this account');
  return user.companyId;
}

async function findPreviousCompanyByName(companyName) {
  if (!companyName?.trim()) return null;
  const escaped = companyName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return Company.findOne({
    name: { $regex: new RegExp(`^${escaped}$`, 'i') },
  });
}

function mapVerificationRequest(request, extras = {}) {
  return {
    id: request._id,
    employeeId: request.employeeId,
    jobExperienceId: request.jobExperienceId,
    previousCompanyName: request.previousCompanyName,
    verificationChannel: request.verificationChannel,
    hrEmail: request.hrEmail,
    status: request.status,
    verificationResult: request.verificationResult,
    requestedAt: request.requestedAt || request.createdAt,
    respondedAt: request.respondedAt,
    ...extras,
  };
}

async function applyVerificationResult(job, result) {
  if (result === 'verified') {
    job.status = 'verified';
  } else if (result === 'rejected') {
    job.status = 'not_verified';
  }
  await job.save();
  await refreshCachedScore(job.userId);
}

export async function createVerificationRequest(user, payload) {
  const companyId = requireCompanyId(user);
  const employeeId = assertValidObjectId(payload.employeeId, 'employee id');
  const jobExperienceId = assertValidObjectId(payload.jobExperienceId, 'job experience id');

  const [linkedEmployee, job, requestingCompany] = await Promise.all([
    CompanyEmployee.findOne({ companyId, employeeId, employmentStatus: 'active' }),
    JobExperience.findOne({ _id: jobExperienceId, userId: employeeId }),
    Company.findById(companyId).select('name'),
  ]);

  if (!linkedEmployee) {
    throw ApiError.badRequest('Employee is not linked to your company');
  }
  if (!job) throw ApiError.notFound('Job experience record not found for this employee');

  const existingPending = await VerificationRequest.findOne({
    requestingCompanyId: companyId,
    employeeId,
    jobExperienceId,
    status: { $in: ['pending', 'in_process'] },
  });
  if (existingPending) {
    throw ApiError.conflict('A pending verification request already exists for this job');
  }

  const previousCompany = await findPreviousCompanyByName(job.company);
  const verificationChannel = previousCompany ? 'platform' : 'email';
  const hrEmail = payload.hrEmail || job.hrEmail || job.companyEmail || '';

  if (verificationChannel === 'email' && !hrEmail) {
    throw ApiError.badRequest('HR email is required when previous company is not on PagerLook');
  }

  const verificationRequest = await VerificationRequest.create({
    requestingCompanyId: companyId,
    targetCompanyId: previousCompany?._id || null,
    employeeId,
    jobExperienceId,
    previousCompanyName: job.company,
    verificationChannel,
    hrEmail,
    hrName: payload.hrName || '',
    status: verificationChannel === 'platform' ? 'pending' : 'in_process',
    requestedBy: user._id,
    requestedAt: new Date(),
    notes: verificationChannel === 'email'
      ? 'Verification email sent to HR/Manager (mock)'
      : 'Verification request sent to previous company dashboard',
  });

  job.status = 'in_process';
  await job.save();

  await createCompanyAuditLog({
    companyId,
    actorUserId: user._id,
    employeeId,
    action: 'verification_request_created',
    entityType: 'verification_request',
    entityId: verificationRequest._id,
    metadata: {
      verificationChannel,
      previousCompanyName: job.company,
      targetCompanyId: previousCompany?._id?.toString() || null,
    },
  });

  return mapVerificationRequest(verificationRequest, {
    previousCompanyRegistered: Boolean(previousCompany),
    message: verificationChannel === 'platform'
      ? 'Request sent to previous company dashboard'
      : 'HR email verification process initiated',
  });
}

export async function listOutgoingVerificationRequests(user) {
  const companyId = requireCompanyId(user);
  const requests = await VerificationRequest.find({ requestingCompanyId: companyId })
    .sort({ createdAt: -1 });

  return {
    summary: {
      total: requests.length,
      approved: requests.filter((r) => r.status === 'approved').length,
      pending: requests.filter((r) => ['pending', 'in_process'].includes(r.status)).length,
      rejected: requests.filter((r) => r.status === 'rejected').length,
    },
    requests: requests.map((request) => mapVerificationRequest(request)),
  };
}

export async function listIncomingVerificationRequests(user) {
  const companyId = requireCompanyId(user);
  const requests = await VerificationRequest.find({
    targetCompanyId: companyId,
    verificationChannel: 'platform',
  }).sort({ createdAt: -1 });

  return requests.map((request) => mapVerificationRequest(request));
}

async function respondToVerificationRequest(user, requestId, status, verificationResult) {
  const companyId = requireCompanyId(user);
  const validId = assertValidObjectId(requestId, 'verification request id');

  const request = await VerificationRequest.findOne({
    _id: validId,
    targetCompanyId: companyId,
    verificationChannel: 'platform',
  });

  if (!request) throw ApiError.notFound('Verification request not found');
  if (!['pending', 'in_process'].includes(request.status)) {
    throw ApiError.badRequest('Verification request already processed');
  }

  request.status = status;
  request.verificationResult = verificationResult;
  request.respondedBy = user._id;
  request.respondedAt = new Date();
  request.scoreImpactApplied = true;
  await request.save();

  const job = await JobExperience.findById(request.jobExperienceId);
  if (job) {
    await applyVerificationResult(job, verificationResult);
  }

  await createCompanyAuditLog({
    companyId,
    actorUserId: user._id,
    employeeId: request.employeeId,
    action: status === 'approved' ? 'verification_request_approved' : 'verification_request_rejected',
    entityType: 'verification_request',
    entityId: request._id,
    metadata: { verificationResult },
  });

  await createCompanyAuditLog({
    companyId: request.requestingCompanyId,
    actorUserId: user._id,
    employeeId: request.employeeId,
    action: status === 'approved' ? 'verification_request_approved' : 'verification_request_rejected',
    entityType: 'verification_request',
    entityId: request._id,
    metadata: { verificationResult, respondedByCompanyId: companyId.toString() },
  });

  return mapVerificationRequest(request);
}

export async function approveVerificationRequest(user, requestId) {
  return respondToVerificationRequest(user, requestId, 'approved', 'verified');
}

export async function rejectVerificationRequest(user, requestId) {
  return respondToVerificationRequest(user, requestId, 'rejected', 'rejected');
}

export async function completeEmailVerification(user, requestId, payload) {
  const companyId = requireCompanyId(user);
  const validId = assertValidObjectId(requestId, 'verification request id');

  const request = await VerificationRequest.findOne({
    _id: validId,
    requestingCompanyId: companyId,
    verificationChannel: 'email',
    status: 'in_process',
  });

  if (!request) throw ApiError.notFound('Email verification request not found');

  const approved = payload.verified === true;
  request.status = approved ? 'approved' : 'rejected';
  request.verificationResult = approved ? 'verified' : 'rejected';
  request.respondedAt = new Date();
  request.respondedBy = user._id;
  request.scoreImpactApplied = true;
  request.notes = payload.notes || request.notes;
  await request.save();

  const job = await JobExperience.findById(request.jobExperienceId);
  if (job) {
    await applyVerificationResult(job, request.verificationResult);
  }

  await createCompanyAuditLog({
    companyId,
    actorUserId: user._id,
    employeeId: request.employeeId,
    action: approved ? 'verification_request_approved' : 'verification_request_rejected',
    entityType: 'verification_request',
    entityId: request._id,
    metadata: { verificationChannel: 'email' },
  });

  return mapVerificationRequest(request);
}
