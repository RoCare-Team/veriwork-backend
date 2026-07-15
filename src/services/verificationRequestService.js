import { Company } from '../models/Company.js';
import { EmployeeProfile } from '../models/EmployeeProfile.js';
import { JobExperience } from '../models/JobExperience.js';
import { VerificationRequest } from '../models/VerificationRequest.js';
import { ApiError } from '../utils/ApiError.js';
import { assertValidObjectId } from '../utils/objectId.js';
import { createCompanyAuditLog } from './companyLinkingService.js';
import { CompanyEmployee } from '../models/CompanyEmployee.js';
import {
  ACCESS_TYPES,
  requireEmployeeAccess,
} from './employeeAccessService.js';
import {
  buildPermanentVerificationRecord,
  completePlatformVerificationResponse,
  createEmployeeVerificationRequest,
  findPreviousCompanyByName,
  getExistingApprovedVerification,
  getJobVerificationStatus,
  getPermanentVerificationRecordForJob,
  getVerificationTags,
  listEmployeeVerificationRequests,
  mapVerificationRequest,
  maybeApplyDocumentFallback,
  getPublicVerificationByToken,
  respondToPublicVerification,
  uploadPublicVerificationDocument,
  sendVerificationEmails,
  deriveEmailStatus,
  isPermanentlyVerifiedJob,
  applyVerificationResult,
  generateExternalToken,
} from './employmentVerificationService.js';
import { createActivity } from './activityService.js';
import { OPEN_STATUSES, COMPLETED_VERIFIED_STATUSES } from '../utils/verificationStatusUtils.js';
import { getVerificationTagLabel } from './verificationTagsService.js';
import { markEmployeeVerifiedForCompany } from './workforceOnboardingService.js';
import { processEmployeeDocumentFallbacks } from './employmentVerificationService.js';

async function maybeMarkWorkforceVerified(request) {
  if (request?.initiatedBy === 'company' && request.requestingCompanyId) {
    await markEmployeeVerifiedForCompany(request.requestingCompanyId, request.employeeId);
  }
}

function requireCompanyId(user) {
  if (!user.companyId) throw ApiError.forbidden('No company associated with this account');
  return user.companyId;
}

async function enrichVerificationRequests(requests) {
  if (!requests.length) return [];

  const employeeIds = [...new Set(requests.map((r) => r.employeeId?.toString()).filter(Boolean))];
  const jobIds = [...new Set(requests.map((r) => r.jobExperienceId?.toString()).filter(Boolean))];

  const [profiles, jobs] = await Promise.all([
    EmployeeProfile.find({ userId: { $in: employeeIds } }).select('name userId'),
    JobExperience.find({ _id: { $in: jobIds } }).select('title company'),
  ]);

  const profileMap = new Map(profiles.map((p) => [p.userId.toString(), p]));
  const jobMap = new Map(jobs.map((j) => [j._id.toString(), j]));

  return requests.map((request) => {
    const profile = profileMap.get(request.employeeId?.toString());
    const job = jobMap.get(request.jobExperienceId?.toString());
    return mapVerificationRequest(request, {
      employeeName: profile?.name || 'Employee',
      jobTitle: job?.title || '',
      companyName: job?.company || request.previousCompanyName,
    });
  });
}

export async function createVerificationRequest(user, payload) {
  const companyId = requireCompanyId(user);
  const employeeId = assertValidObjectId(payload.employeeId, 'employee id');
  const jobExperienceId = assertValidObjectId(payload.jobExperienceId, 'job experience id');

  await requireEmployeeAccess(companyId, employeeId, ACCESS_TYPES.FULL_PROFILE);

  const [linkedEmployee, job, requestingCompany] = await Promise.all([
    CompanyEmployee.findOne({ companyId, employeeId, employmentStatus: 'active' }),
    JobExperience.findOne({ _id: jobExperienceId, userId: employeeId }),
    Company.findById(companyId).select('name'),
  ]);

  if (!linkedEmployee) {
    throw ApiError.badRequest('Employee is not linked to your company');
  }
  if (!job) throw ApiError.notFound('Job experience record not found for this employee');

  const existingApproved = await getExistingApprovedVerification(job._id);
  if (existingApproved || isPermanentlyVerifiedJob(job)) {
    return {
      alreadyVerified: true,
      verificationRecord: buildPermanentVerificationRecord(job, existingApproved),
      message: 'This employment is already verified. Future companies can reuse this record.',
    };
  }

  const existingPending = await VerificationRequest.findOne({
    requestingCompanyId: companyId,
    employeeId,
    jobExperienceId,
    status: { $in: [...OPEN_STATUSES, 'pending'] },
  });
  if (existingPending) {
    // Only block when the previous request actually reached the recipient. If a prior
    // email never went out (failed / mock / not configured), retry on the SAME request
    // instead of throwing — no duplicate, and the user isn't stuck.
    const emailNeverSent = existingPending.verificationChannel === 'email'
      && ['failed', 'mock', 'not_sent', 'not_applicable'].includes(existingPending.emailStatus);

    if (!emailNeverSent) {
      throw ApiError.conflict('A pending verification request already exists for this job');
    }

    const retryHrEmail = payload.hrEmail || existingPending.hrEmail || job.hrEmail || '';
    const retryManagerEmail = payload.managerEmail
      || existingPending.managerEmail || job.managerEmail || job.companyEmail || '';
    if (!retryHrEmail && !retryManagerEmail) {
      throw ApiError.badRequest('HR email or manager email is required to send the verification');
    }

    existingPending.hrEmail = retryHrEmail;
    existingPending.managerEmail = retryManagerEmail;
    if (payload.hrName) existingPending.hrName = payload.hrName;

    const now = Date.now();
    if (!existingPending.externalToken
      || (existingPending.externalTokenExpiresAt && existingPending.externalTokenExpiresAt.getTime() <= now)) {
      existingPending.externalToken = generateExternalToken();
      existingPending.externalTokenExpiresAt = new Date(now + 14 * 24 * 60 * 60 * 1000);
    }
    await existingPending.save();

    const retryProfile = await EmployeeProfile.findOne({ userId: employeeId }).select('name');
    const retryResult = await sendVerificationEmails(existingPending, job, retryProfile);
    existingPending.emailStatus = deriveEmailStatus('email', retryResult);
    existingPending.emailLastSentAt = new Date();
    await existingPending.save();

    return mapVerificationRequest(existingPending, {
      employeeName: linkedEmployee.employeeName || '',
      jobTitle: job.title,
      companyName: job.company,
      previousCompanyRegistered: false,
      emailSent: retryResult.sent,
      emailMock: retryResult.mock,
      message: retryResult.sent
        ? 'Verification email sent to HR/Manager'
        : retryResult.mock
          ? 'Mailer not configured — logged in mock mode. Configure SMTP in Settings to send for real.'
          : 'Could not send the email. Check your SMTP settings and try again.',
    });
  }

  const previousCompany = payload.targetCompanyId
    ? await Company.findById(assertValidObjectId(payload.targetCompanyId, 'target company id'))
    : await findPreviousCompanyByName(job.company, companyId);

  if (payload.targetCompanyId && !previousCompany) {
    throw ApiError.badRequest('Selected platform company not found');
  }
  if (previousCompany && previousCompany._id.equals(companyId)) {
    throw ApiError.badRequest('Cannot verify with your own company as previous employer');
  }

  const verificationChannel = previousCompany ? 'platform' : 'email';
  const hrEmail = payload.hrEmail || job.hrEmail || '';
  const managerEmail = payload.managerEmail || job.managerEmail || job.companyEmail || '';

  if (verificationChannel === 'email' && !hrEmail && !managerEmail) {
    throw ApiError.badRequest('HR email or manager email is required when previous company is not on PagerLook');
  }

  if (hrEmail) job.hrEmail = hrEmail;
  if (managerEmail) job.managerEmail = managerEmail;
  job.status = 'in_process';
  await job.save();

  if (linkedEmployee.onboardingStage === 'incoming') {
    linkedEmployee.onboardingStage = 'pending_verification';
    await linkedEmployee.save();
  }

  const externalToken = verificationChannel === 'email' ? generateExternalToken() : null;
  const externalTokenExpiresAt = externalToken
    ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    : null;

  const platformStatus = 'pending_employee_consent';

  const verificationRequest = await VerificationRequest.create({
    initiatedBy: 'company',
    requestingCompanyId: companyId,
    targetCompanyId: previousCompany?._id || null,
    employeeId,
    jobExperienceId,
    previousCompanyName: job.company,
    verificationChannel,
    hrEmail,
    managerEmail,
    hrName: payload.hrName || '',
    status: verificationChannel === 'platform' ? platformStatus : 'in_review',
    requestedBy: user._id,
    requestedAt: new Date(),
    notes: verificationChannel === 'platform'
      ? `Awaiting employee consent to contact ${job.company} on PagerLook`
      : 'Verification email sent to HR/Manager',
    externalToken,
    externalTokenExpiresAt,
  });

  let emailResult = { sent: false, mock: true };
  if (verificationChannel === 'email') {
    const profile = await EmployeeProfile.findOne({ userId: employeeId }).select('name');
    emailResult = await sendVerificationEmails(verificationRequest, job, profile);
    verificationRequest.emailStatus = deriveEmailStatus(verificationChannel, emailResult);
    verificationRequest.emailLastSentAt = new Date();
    await verificationRequest.save();
  }

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
      awaitingEmployeeConsent: verificationChannel === 'platform',
    },
  });

  await createActivity(employeeId, {
    type: 'verification',
    title: verificationChannel === 'platform'
      ? 'Approve verification with previous employer'
      : 'Employment verification started',
    message: verificationChannel === 'platform'
      ? `${requestingCompany?.name || 'Your current company'} wants to verify your employment at ${job.company} with their HR on PagerLook. Approve to send the request to ${job.company}.`
      : `${requestingCompany?.name || 'A company'} started verification for your role at ${job.company}.`,
    company: requestingCompany?.name || job.company,
    status: 'pending',
    metadata: {
      verificationRequestId: verificationRequest._id.toString(),
      verificationChannel,
      event: verificationChannel === 'platform' ? 'verification_consent_request' : 'verification_request',
      previousCompanyName: job.company,
      requestingCompanyName: requestingCompany?.name || '',
    },
  });

  return mapVerificationRequest(verificationRequest, {
    employeeName: linkedEmployee.employeeName || '',
    jobTitle: job.title,
    companyName: job.company,
    previousCompanyRegistered: Boolean(previousCompany),
    awaitingEmployeeConsent: verificationChannel === 'platform',
    emailSent: emailResult.sent,
    emailMock: emailResult.mock,
    message: verificationChannel === 'platform'
      ? `Consent request sent to employee. After approval, ${job.company} will receive the verification request.`
      : 'Verification email sent to HR/Manager',
  });
}

export async function approveEmployeeVerificationConsent(userId, requestId) {
  const validId = assertValidObjectId(requestId, 'verification request id');

  const request = await VerificationRequest.findOne({
    _id: validId,
    employeeId: userId,
    status: 'pending_employee_consent',
    verificationChannel: 'platform',
    initiatedBy: 'company',
  });
  if (!request) throw ApiError.notFound('Verification consent request not found or already processed');

  const [job, requestingCompany, targetCompany, profile] = await Promise.all([
    JobExperience.findById(request.jobExperienceId),
    request.requestingCompanyId ? Company.findById(request.requestingCompanyId).select('name') : null,
    request.targetCompanyId ? Company.findById(request.targetCompanyId).select('name') : null,
    EmployeeProfile.findOne({ userId }).select('name'),
  ]);

  request.status = 'pending';
  request.notes = `${request.notes || ''} Employee approved — sent to ${targetCompany?.name || request.previousCompanyName} for review.`.trim();
  await request.save();

  if (request.requestingCompanyId) {
    await createCompanyAuditLog({
      companyId: request.requestingCompanyId,
      actorUserId: userId,
      employeeId: userId,
      action: 'verification_consent_approved',
      entityType: 'verification_request',
      entityId: request._id,
      metadata: { targetCompanyId: request.targetCompanyId?.toString() },
    });
  }

  if (request.targetCompanyId) {
    await createCompanyAuditLog({
      companyId: request.targetCompanyId,
      actorUserId: userId,
      employeeId: userId,
      action: 'verification_request_received',
      entityType: 'verification_request',
      entityId: request._id,
      metadata: {
        requestingCompanyName: requestingCompany?.name || '',
        employeeName: profile?.name || '',
      },
    });
  }

  await createActivity(userId, {
    type: 'verification',
    title: 'Verification consent granted',
    message: `You approved verification with ${request.previousCompanyName}. Their HR will review on PagerLook.`,
    company: request.previousCompanyName,
    status: 'info',
    metadata: {
      verificationRequestId: request._id.toString(),
      event: 'verification_consent_approved',
    },
  });

  return mapVerificationRequest(request, {
    employeeName: profile?.name || '',
    jobTitle: job?.title || '',
    companyName: job?.company || request.previousCompanyName,
    requestingCompanyName: requestingCompany?.name || '',
    targetCompanyName: targetCompany?.name || request.previousCompanyName,
    message: `Request sent to ${targetCompany?.name || request.previousCompanyName} for HR review.`,
  });
}

export async function rejectEmployeeVerificationConsent(userId, requestId, payload = {}) {
  const validId = assertValidObjectId(requestId, 'verification request id');

  const request = await VerificationRequest.findOne({
    _id: validId,
    employeeId: userId,
    status: 'pending_employee_consent',
    verificationChannel: 'platform',
    initiatedBy: 'company',
  });
  if (!request) throw ApiError.notFound('Verification consent request not found or already processed');

  request.status = 'rejected';
  request.verificationResult = 'rejected';
  request.respondedAt = new Date();
  request.notes = payload.reason?.trim()
    || payload.notes?.trim()
    || 'Employee rejected verification with previous employer';
  await request.save();

  const job = await JobExperience.findById(request.jobExperienceId);
  if (job && job.status === 'in_process') {
    job.status = 'not_verified';
    await job.save();
  }

  const requestingCompany = request.requestingCompanyId
    ? await Company.findById(request.requestingCompanyId).select('name')
    : null;

  if (request.requestingCompanyId) {
    await createCompanyAuditLog({
      companyId: request.requestingCompanyId,
      actorUserId: userId,
      employeeId: userId,
      action: 'verification_consent_rejected',
      entityType: 'verification_request',
      entityId: request._id,
      metadata: { reason: request.notes },
    });
  }

  await createActivity(userId, {
    type: 'verification',
    title: 'Verification consent rejected',
    message: `You declined verification with ${request.previousCompanyName}.`,
    company: requestingCompany?.name || request.previousCompanyName,
    status: 'info',
    metadata: {
      verificationRequestId: request._id.toString(),
      event: 'verification_consent_rejected',
    },
  });

  return mapVerificationRequest(request, {
    message: 'Verification request cancelled.',
  });
}

export async function listOutgoingVerificationRequests(user) {
  const companyId = requireCompanyId(user);

  const requests = await VerificationRequest.find({ requestingCompanyId: companyId })
    .sort({ createdAt: -1 });

  const enriched = await enrichVerificationRequests(requests);

  const employeeIds = [...new Set(requests.map((r) => r.employeeId?.toString()).filter(Boolean))];
  await Promise.all(employeeIds.map((id) => processEmployeeDocumentFallbacks(id).catch(() => {})));

  return {
    summary: {
      total: enriched.length,
      approved: enriched.filter((r) => COMPLETED_VERIFIED_STATUSES.includes(r.rawStatus || r.status)).length,
      pending: enriched.filter((r) => OPEN_STATUSES.includes(r.rawStatus) || r.status === 'pending').length,
      hrResponded: enriched.filter((r) => r.rawStatus === 'hr_responded').length,
      rejected: enriched.filter((r) => r.rawStatus === 'rejected').length,
      expired: enriched.filter((r) => r.rawStatus === 'expired').length,
    },
    requests: enriched,
  };
}

export async function listIncomingVerificationRequests(user) {
  const companyId = requireCompanyId(user);
  const requests = await VerificationRequest.find({
    targetCompanyId: companyId,
    verificationChannel: 'platform',
    status: { $in: ['pending', 'in_review', 'in_process', 'hr_responded', 'verified', 'rejected'] },
  }).sort({ createdAt: -1 });

  const enriched = await enrichVerificationRequests(requests);

  return {
    summary: {
      total: enriched.length,
      pending: enriched.filter((r) => ['pending', 'in_review', 'in_process'].includes(r.rawStatus)).length,
      verified: enriched.filter((r) => COMPLETED_VERIFIED_STATUSES.includes(r.rawStatus)).length,
      rejected: enriched.filter((r) => r.rawStatus === 'rejected').length,
    },
    requests: enriched,
  };
}

export async function approveVerificationRequest(user, requestId, payload = {}) {
  const companyId = requireCompanyId(user);
  const validId = assertValidObjectId(requestId, 'verification request id');

  const request = await VerificationRequest.findOne({
    _id: validId,
    targetCompanyId: companyId,
    verificationChannel: 'platform',
  });

  if (!request) throw ApiError.notFound('Verification request not found');
  if (!['pending', 'in_process', 'in_review'].includes(request.status)) {
    throw ApiError.badRequest('Verification request already processed');
  }

  const employmentDetails = {
    workedHere: payload.workedHere !== false,
    designation: payload.designation || payload.jobTitle || '',
    joiningDate: payload.joiningDate || '',
    exitDate: payload.exitDate || '',
    duration: payload.duration || '',
    feedback: payload.feedback || payload.hrFeedback || '',
    rehireEligible: payload.rehireEligible ?? null,
    verificationNotes: payload.verificationNotes || payload.notes || '',
    employmentType: payload.employmentType || '',
    employmentStatus: payload.employmentStatus || '',
  };

  await completePlatformVerificationResponse(request, {
    status: 'verified',
    verificationResult: 'verified',
    respondedBy: user._id,
    employmentDetails,
  });

  await createCompanyAuditLog({
    companyId,
    actorUserId: user._id,
    employeeId: request.employeeId,
    action: 'verification_request_approved',
    entityType: 'verification_request',
    entityId: request._id,
    metadata: { verificationResult: 'verified', verificationLevel: 'employer_verified' },
  });

  if (request.requestingCompanyId) {
    await createCompanyAuditLog({
      companyId: request.requestingCompanyId,
      actorUserId: user._id,
      employeeId: request.employeeId,
      action: 'verification_request_approved',
      entityType: 'verification_request',
      entityId: request._id,
      metadata: {
        verificationResult: 'verified',
        respondedByCompanyId: companyId.toString(),
        verificationLevel: 'employer_verified',
      },
    });
    await maybeMarkWorkforceVerified(request);
  }

  return mapVerificationRequest(request);
}

export async function rejectVerificationRequest(user, requestId, payload = {}) {
  const companyId = requireCompanyId(user);
  const validId = assertValidObjectId(requestId, 'verification request id');

  const request = await VerificationRequest.findOne({
    _id: validId,
    targetCompanyId: companyId,
    verificationChannel: 'platform',
  });

  if (!request) throw ApiError.notFound('Verification request not found');
  if (!['pending', 'in_process', 'in_review'].includes(request.status)) {
    throw ApiError.badRequest('Verification request already processed');
  }

  await completePlatformVerificationResponse(request, {
    status: 'rejected',
    verificationResult: 'rejected',
    respondedBy: user._id,
    employmentDetails: {
      workedHere: false,
      feedback: payload.feedback || payload.notes || '',
      verificationNotes: payload.notes || '',
    },
  });

  await createCompanyAuditLog({
    companyId,
    actorUserId: user._id,
    employeeId: request.employeeId,
    action: 'verification_request_rejected',
    entityType: 'verification_request',
    entityId: request._id,
    metadata: { verificationResult: 'rejected' },
  });

  return mapVerificationRequest(request);
}

export async function reviewHrResponse(user, requestId, payload) {
  const companyId = requireCompanyId(user);
  const validId = assertValidObjectId(requestId, 'verification request id');

  const request = await VerificationRequest.findOne({
    _id: validId,
    requestingCompanyId: companyId,
    verificationChannel: 'email',
    status: 'hr_responded',
  });

  if (!request) throw ApiError.notFound('HR response awaiting review not found');

  const approved = payload.approved === true;
  const job = await JobExperience.findById(request.jobExperienceId);
  if (!job) throw ApiError.notFound('Job experience not found');

  if (approved) {
    request.status = 'verified';
    request.verificationResult = 'verified';
    request.verificationLevel = 'hr_verified';
    request.resolvedVia = 'company_review';
    request.respondedBy = user._id;
    request.respondedAt = new Date();
    request.scoreImpactApplied = true;
    await request.save();

    await applyVerificationResult(job, 'verified', {
      verificationLevel: 'hr_verified',
      employmentDetails: request.employmentDetails,
      feedback: request.employmentDetails?.feedback,
    });
    await maybeMarkWorkforceVerified(request);
  } else {
    request.status = 'rejected';
    request.verificationResult = 'rejected';
    request.resolvedVia = 'company_review';
    request.respondedBy = user._id;
    request.respondedAt = new Date();
    request.notes = payload.notes || request.notes;
    await request.save();

    await applyVerificationResult(job, 'rejected', { verificationLevel: 'none' });
  }

  await createCompanyAuditLog({
    companyId,
    actorUserId: user._id,
    employeeId: request.employeeId,
    action: approved ? 'verification_hr_response_approved' : 'verification_hr_response_rejected',
    entityType: 'verification_request',
    entityId: request._id,
    metadata: { verificationLevel: approved ? 'hr_verified' : null },
  });

  return mapVerificationRequest(request, {
    verificationTag: approved
      ? { id: 'hr_verified', label: getVerificationTagLabel('hr_verified') }
      : null,
  });
}

export async function confirmDocumentVerification(user, requestId, payload = {}) {
  const companyId = requireCompanyId(user);
  const validId = assertValidObjectId(requestId, 'verification request id');

  const request = await VerificationRequest.findOne({
    _id: validId,
    requestingCompanyId: companyId,
    verificationChannel: 'email',
    status: { $in: ['in_review', 'in_process', 'expired', 'hr_responded'] },
  });

  if (!request) throw ApiError.notFound('Verification request not eligible for document verification');

  const fallback = await maybeApplyDocumentFallback(request, { force: true });
  if (!fallback) {
    throw ApiError.badRequest(
      'No employment documents found for document-based verification. Upload offer letter, salary slips, or experience letter first.',
    );
  }

  await createCompanyAuditLog({
    companyId,
    actorUserId: user._id,
    employeeId: request.employeeId,
    action: 'verification_document_confirmed',
    entityType: 'verification_request',
    entityId: request._id,
    metadata: { verificationLevel: 'document_verified', notes: payload.notes || '' },
  });

  await maybeMarkWorkforceVerified(await VerificationRequest.findById(request._id));

  return {
    verificationRecord: fallback,
    request: mapVerificationRequest(await VerificationRequest.findById(request._id)),
  };
}

export async function completeEmailVerification(user, requestId, payload) {
  const companyId = requireCompanyId(user);
  const validId = assertValidObjectId(requestId, 'verification request id');

  const request = await VerificationRequest.findOne({
    _id: validId,
    requestingCompanyId: companyId,
    verificationChannel: 'email',
  });

  if (!request) throw ApiError.notFound('Email verification request not found');

  if (request.status === 'hr_responded') {
    return reviewHrResponse(user, requestId, { approved: payload.verified === true, notes: payload.notes });
  }

  if (!['in_review', 'in_process', 'expired'].includes(request.status)) {
    throw ApiError.badRequest('Verification request is not eligible for manual completion');
  }

  if (payload.verified === true) {
    if (request.status === 'hr_responded') {
      return reviewHrResponse(user, requestId, { approved: true, notes: payload.notes });
    }
    return confirmDocumentVerification(user, requestId, payload);
  }

  if (payload.useDocuments === true) {
    return confirmDocumentVerification(user, requestId, payload);
  }

  request.status = 'rejected';
  request.verificationResult = 'rejected';
  request.resolvedVia = 'company_review';
  request.respondedAt = new Date();
  request.respondedBy = user._id;
  request.scoreImpactApplied = true;
  request.notes = payload.notes || request.notes;
  await request.save();

  const job = await JobExperience.findById(request.jobExperienceId);
  if (job) {
    await applyVerificationResult(job, 'rejected', { verificationLevel: 'none' });
  }

  return mapVerificationRequest(request);
}

export async function getEmployeeJobVerificationRecord(user, employeeId, jobId) {
  const companyId = requireCompanyId(user);
  const validEmployeeId = assertValidObjectId(employeeId, 'employee id');
  const validJobId = assertValidObjectId(jobId, 'job id');

  await requireEmployeeAccess(companyId, validEmployeeId, ACCESS_TYPES.FULL_PROFILE);

  const linked = await CompanyEmployee.findOne({
    companyId,
    employeeId: validEmployeeId,
    employmentStatus: 'active',
  });
  if (!linked) throw ApiError.badRequest('Employee is not linked to your company');

  const record = await getPermanentVerificationRecordForJob(validJobId);
  if (record) return record;

  const job = await JobExperience.findOne({ _id: validJobId, userId: validEmployeeId });
  if (!job) throw ApiError.notFound('Job not found');

  return {
    jobExperienceId: job._id,
    company: job.company,
    title: job.title,
    verificationLevel: job.verificationLevel,
    status: job.status,
    isReusable: false,
  };
}

export async function resendVerificationEmail(user, requestId) {
  const companyId = requireCompanyId(user);
  const validId = assertValidObjectId(requestId, 'verification request id');

  const request = await VerificationRequest.findOne({
    _id: validId,
    requestingCompanyId: companyId,
    verificationChannel: 'email',
  });

  if (!request) throw ApiError.notFound('Email verification request not found');
  if (!['in_review', 'in_process'].includes(request.status)) {
    throw ApiError.badRequest('This request can no longer be re-sent (already responded, verified, or closed)');
  }

  const job = await JobExperience.findById(request.jobExperienceId);
  if (!job) throw ApiError.notFound('Job experience not found');

  // Refresh the secure token if it has expired so the resent link stays valid.
  const now = Date.now();
  if (!request.externalToken || (request.externalTokenExpiresAt && request.externalTokenExpiresAt.getTime() <= now)) {
    request.externalToken = generateExternalToken();
    request.externalTokenExpiresAt = new Date(now + 14 * 24 * 60 * 60 * 1000);
    await request.save();
  }

  const profile = await EmployeeProfile.findOne({ userId: request.employeeId }).select('name');
  const emailResult = await sendVerificationEmails(request, job, profile);

  request.emailStatus = deriveEmailStatus('email', emailResult);
  request.emailLastSentAt = new Date();
  await request.save();

  await createCompanyAuditLog({
    companyId,
    actorUserId: user._id,
    employeeId: request.employeeId,
    action: 'verification_email_resent',
    entityType: 'verification_request',
    entityId: request._id,
    metadata: { emailStatus: request.emailStatus, recipients: emailResult.recipients || [] },
  });

  return mapVerificationRequest(request, {
    emailSent: emailResult.sent,
    emailMock: emailResult.mock,
    message: emailResult.sent
      ? 'Verification email re-sent successfully'
      : emailResult.mock
        ? 'Mailer not configured — email logged in mock mode. Configure SMTP to send for real.'
        : 'Failed to send email. Check your SMTP settings and try again.',
  });
}

export {
  createEmployeeVerificationRequest,
  getJobVerificationStatus,
  listEmployeeVerificationRequests,
  getVerificationTags,
  getPublicVerificationByToken,
  respondToPublicVerification,
  uploadPublicVerificationDocument,
};
