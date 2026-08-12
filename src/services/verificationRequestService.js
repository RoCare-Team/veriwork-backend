import { Company } from '../models/Company.js';
import { EmployeeProfile } from '../models/EmployeeProfile.js';
import { JobExperience } from '../models/JobExperience.js';
import { VerificationRequest } from '../models/VerificationRequest.js';
import { ApiError } from '../utils/ApiError.js';
import { assertValidObjectId } from '../utils/objectId.js';
import { createCompanyAuditLog } from './companyLinkingService.js';
import { CompanyEmployee } from '../models/CompanyEmployee.js';
import { User } from '../models/User.js';
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
  getResendState,
  uniqueEmails,
  RESEND_COOLDOWN_MINUTES,
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

  // forceEmail: the requester looked at the auto-matched company and said "that's
  // not them" — verify via the HR contacts on record instead of the platform.
  const previousCompany = payload.forceEmail
    ? null
    : payload.targetCompanyId
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

/**
 * Email-channel resend, shared by the employee follow-up and the platform
 * admin's support resend.
 *
 * Swaps in corrected/added recipients (any number of them), keeps the secure
 * link alive, mails everyone on the list, and stamps delivery. Returns the
 * addresses actually mailed.
 *
 * `skipCooldown` exists for the platform admin: they act on a support request
 * that has already been chased, so the employee-facing throttle would only get
 * in the way.
 */
async function performEmailResend(request, job, payload = {}, { skipCooldown = false } = {}) {
  const nextContacts = uniqueEmails([
    payload.hrEmail,
    payload.managerEmail,
    ...(payload.hrContacts || []),
  ]);
  const currentContacts = uniqueEmails([
    request.hrEmail,
    request.managerEmail,
    ...(request.hrContacts || []),
  ]);
  const contactsChanged = nextContacts.length > 0
    && nextContacts.join(',').toLowerCase() !== currentContacts.join(',').toLowerCase();

  // A new recipient hasn't been mailed yet, so the cool-down doesn't apply.
  if (!skipCooldown && !getResendState(request).canResend && !contactsChanged) {
    throw ApiError.tooManyRequests(
      `The email was just sent. Please wait ${RESEND_COOLDOWN_MINUTES} minutes before re-sending.`,
    );
  }

  if (contactsChanged) {
    request.hrEmail = nextContacts[0] || '';
    request.managerEmail = nextContacts[1] || '';
    request.hrContacts = nextContacts;
    job.hrEmail = nextContacts[0] || '';
    job.managerEmail = nextContacts[1] || '';
    job.hrContacts = nextContacts;
    await job.save();
  }
  if (payload.hrName) request.hrName = payload.hrName;

  const recipients = uniqueEmails([request.hrEmail, request.managerEmail, ...(request.hrContacts || [])]);
  if (recipients.length === 0) {
    throw ApiError.badRequest('Add at least one HR contact email before re-sending the request.');
  }

  // A resend must arrive with a link that still works — mint a fresh token when
  // the old one lapsed, and reopen the request that expired with it.
  const now = Date.now();
  if (!request.externalToken
    || (request.externalTokenExpiresAt && request.externalTokenExpiresAt.getTime() <= now)) {
    request.externalToken = generateExternalToken();
    request.externalTokenExpiresAt = new Date(now + 14 * 24 * 60 * 60 * 1000);
  }
  if (request.status === 'expired') {
    request.status = 'in_review';
    request.resolvedVia = null;
  }
  if (job.status !== 'verified') {
    job.status = 'in_process';
    await job.save();
  }
  await request.save();

  const profile = await EmployeeProfile.findOne({ userId: request.employeeId }).select('name');
  const emailResult = await sendVerificationEmails(request, job, profile);

  request.emailStatus = deriveEmailStatus('email', emailResult);
  request.emailLastSentAt = new Date();
  request.lastRemindedAt = new Date();
  request.remindersSent = (request.remindersSent || 0) + 1;
  await request.save();

  return { recipients, emailResult, contactsChanged };
}

/**
 * Employee follow-up on a request the other side never answered.
 *
 * Deliberately NOT a new request: the same record and the same secure link are
 * reused, so a resend can't create a duplicate the previous employer has to
 * answer twice. Updated HR contacts are accepted (the first address is often a
 * typo or a dead mailbox) and skip the cool-down, since a new recipient has not
 * been mailed yet.
 */
export async function resendEmployeeVerificationRequest(userId, requestId, payload = {}) {
  const validId = assertValidObjectId(requestId, 'verification request id');

  const request = await VerificationRequest.findOne({ _id: validId, employeeId: userId });
  if (!request) throw ApiError.notFound('Verification request not found');

  const job = await JobExperience.findOne({ _id: request.jobExperienceId, userId });
  if (!job) throw ApiError.notFound('Job not found');
  if (isPermanentlyVerifiedJob(job)) {
    throw ApiError.badRequest('This employment is already verified — no follow-up needed.');
  }

  const state = getResendState(request);
  if (!state.canResend && !state.availableAt) {
    // Wrong status (already answered / closed) — never resendable, contacts or not.
    throw ApiError.badRequest(state.reason);
  }

  if (request.verificationChannel === 'platform') {
    if (!state.canResend) {
      throw ApiError.tooManyRequests(
        `A reminder was just sent. Please wait ${RESEND_COOLDOWN_MINUTES} minutes before sending another.`,
      );
    }

    request.lastRemindedAt = new Date();
    request.remindersSent = (request.remindersSent || 0) + 1;
    await request.save();

    if (request.targetCompanyId) {
      await createCompanyAuditLog({
        companyId: request.targetCompanyId,
        actorUserId: userId,
        employeeId: userId,
        action: 'verification_request_reminder',
        entityType: 'verification_request',
        entityId: request._id,
        metadata: { remindersSent: request.remindersSent, previousCompanyName: request.previousCompanyName },
      });
    }

    await createActivity(userId, {
      type: 'verification',
      title: 'Verification reminder sent',
      message: `You sent a reminder to ${request.previousCompanyName} for your employment verification.`,
      company: request.previousCompanyName,
      status: 'info',
      metadata: { verificationRequestId: request._id.toString(), event: 'verification_reminder' },
    });

    return mapVerificationRequest(request, {
      jobTitle: job.title,
      companyName: job.company,
      message: `Reminder sent to ${request.previousCompanyName} on their PagerLook dashboard.`,
    });
  }

  // Email channel — allow correcting/adding recipients before the resend.
  const { recipients, emailResult } = await performEmailResend(request, job, payload);

  await createActivity(userId, {
    type: 'verification',
    title: 'Verification request re-sent',
    message: `You re-sent the verification request for ${job.company} to ${recipients.join(', ')}.`,
    company: job.company,
    status: 'info',
    metadata: {
      verificationRequestId: request._id.toString(),
      event: 'verification_reminder',
      remindersSent: request.remindersSent,
    },
  });

  return mapVerificationRequest(request, {
    jobTitle: job.title,
    companyName: job.company,
    emailSent: emailResult.sent,
    emailMock: emailResult.mock,
    recipients,
    message: emailResult.sent
      ? `Verification request re-sent to ${recipients.join(', ')}.`
      : emailResult.mock
        ? 'Mailer not configured — the email was logged in mock mode. Add your mailbox in Settings to send for real.'
        : 'Could not send the email. Check the HR address and try again.',
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

/* ------------------------------------------------------------------ *
 * Platform admin (support desk)
 *
 * Support gets asked "my verification never reached HR" from both sides of
 * the product, so the admin view spans every request regardless of who
 * started it — and says plainly WHO started it, since that decides whose
 * mailbox the resend goes out from.
 * ------------------------------------------------------------------ */

// Expired requests get their own tab — they are still re-sendable, but they are
// a different kind of problem from one nobody has answered yet.
const ADMIN_OPEN_STATUSES = OPEN_STATUSES;

/** Attribution for a request: the employee themselves, or a company's user. */
function buildRequestedBy(request, { profile, company, user }) {
  if (request.initiatedBy === 'employee') {
    return {
      type: 'employee',
      name: profile?.name || 'Employee',
      email: profile?.email || user?.email || '',
      companyName: '',
      label: `${profile?.name || 'Employee'} (self-initiated)`,
    };
  }

  const companyName = company?.name || 'Company';
  return {
    type: 'company',
    name: companyName,
    email: user?.email || '',
    companyName,
    label: user?.email ? `${companyName} — ${user.email}` : companyName,
  };
}

export async function listVerificationRequestsForAdmin({ status = 'all', q = '' } = {}) {
  const filter = {};
  if (status === 'open') filter.status = { $in: ADMIN_OPEN_STATUSES };
  else if (status && status !== 'all') filter.status = status;

  if (q?.trim()) {
    const escaped = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');
    const [matchedProfiles, matchedCompanies] = await Promise.all([
      EmployeeProfile.find({ $or: [{ name: regex }, { email: regex }, { veriworkId: regex }] })
        .select('userId')
        .limit(200),
      Company.find({ name: regex }).select('_id').limit(100),
    ]);

    filter.$or = [
      { employeeId: { $in: matchedProfiles.map((p) => p.userId) } },
      { requestingCompanyId: { $in: matchedCompanies.map((c) => c._id) } },
      { previousCompanyName: regex },
      { hrEmail: regex },
      { managerEmail: regex },
      { hrContacts: regex },
    ];
  }

  const requests = await VerificationRequest.find(filter).sort({ createdAt: -1 }).limit(300);
  if (!requests.length) {
    return { summary: { total: 0, open: 0, verified: 0, rejected: 0, expired: 0 }, requests: [] };
  }

  const employeeIds = [...new Set(requests.map((r) => r.employeeId?.toString()).filter(Boolean))];
  const jobIds = [...new Set(requests.map((r) => r.jobExperienceId?.toString()).filter(Boolean))];
  const companyIds = [...new Set(
    requests
      .flatMap((r) => [r.requestingCompanyId?.toString(), r.targetCompanyId?.toString()])
      .filter(Boolean),
  )];
  const requesterIds = [...new Set(requests.map((r) => r.requestedBy?.toString()).filter(Boolean))];

  const [profiles, jobs, companies, requesters] = await Promise.all([
    EmployeeProfile.find({ userId: { $in: employeeIds } }).select('userId name email veriworkId'),
    JobExperience.find({ _id: { $in: jobIds } }).select('title company'),
    Company.find({ _id: { $in: companyIds } }).select('name'),
    User.find({ _id: { $in: requesterIds } }).select('email role'),
  ]);

  const profileMap = new Map(profiles.map((p) => [p.userId.toString(), p]));
  const jobMap = new Map(jobs.map((j) => [j._id.toString(), j]));
  const companyMap = new Map(companies.map((c) => [c._id.toString(), c]));
  const requesterMap = new Map(requesters.map((u) => [u._id.toString(), u]));

  const mapped = requests.map((request) => {
    const profile = profileMap.get(request.employeeId?.toString());
    const job = jobMap.get(request.jobExperienceId?.toString());
    const requestingCompany = companyMap.get(request.requestingCompanyId?.toString());
    const targetCompany = companyMap.get(request.targetCompanyId?.toString());
    const resendState = getResendState(request);

    return mapVerificationRequest(request, {
      employeeName: profile?.name || 'Employee',
      employeeEmail: profile?.email || '',
      employeeVeriworkId: profile?.veriworkId || '',
      jobTitle: job?.title || '',
      companyName: job?.company || request.previousCompanyName,
      requestingCompanyName: requestingCompany?.name || '',
      targetCompanyName: targetCompany?.name || '',
      requestedBy: buildRequestedBy(request, {
        profile,
        company: requestingCompany,
        user: requesterMap.get(request.requestedBy?.toString()),
      }),
      // Admins bypass the employee cool-down, so this only reports whether the
      // request is in a state that can be re-sent at all.
      canResend: resendState.canResend || Boolean(resendState.availableAt),
      resendBlockedReason: resendState.availableAt ? '' : resendState.reason,
    });
  });

  return {
    summary: {
      total: mapped.length,
      open: mapped.filter((r) => ADMIN_OPEN_STATUSES.includes(r.rawStatus)).length,
      verified: mapped.filter((r) => COMPLETED_VERIFIED_STATUSES.includes(r.rawStatus)).length,
      rejected: mapped.filter((r) => r.rawStatus === 'rejected').length,
      expired: mapped.filter((r) => r.rawStatus === 'expired').length,
    },
    requests: mapped,
  };
}

/**
 * Support resend. Same request, same secure link — only the recipient list may
 * change. The employee-facing cool-down is skipped: an admin is already acting
 * on a "nobody replied" complaint.
 */
export async function adminResendVerificationRequest(adminUserId, requestId, payload = {}) {
  const validId = assertValidObjectId(requestId, 'verification request id');

  const request = await VerificationRequest.findById(validId);
  if (!request) throw ApiError.notFound('Verification request not found');

  const job = await JobExperience.findById(request.jobExperienceId);
  if (!job) throw ApiError.notFound('Job experience not found');
  if (isPermanentlyVerifiedJob(job)) {
    throw ApiError.badRequest('This employment is already verified — no follow-up needed.');
  }

  const state = getResendState(request);
  if (!state.canResend && !state.availableAt) {
    // Wrong status (already answered / closed) — never resendable, contacts or not.
    throw ApiError.badRequest(state.reason);
  }

  if (request.verificationChannel === 'platform') {
    request.lastRemindedAt = new Date();
    request.remindersSent = (request.remindersSent || 0) + 1;
    await request.save();

    if (request.targetCompanyId) {
      await createCompanyAuditLog({
        companyId: request.targetCompanyId,
        actorUserId: adminUserId,
        employeeId: request.employeeId,
        action: 'verification_request_reminder',
        entityType: 'verification_request',
        entityId: request._id,
        metadata: {
          remindersSent: request.remindersSent,
          previousCompanyName: request.previousCompanyName,
          byPlatformAdmin: true,
        },
      });
    }

    await createActivity(request.employeeId, {
      type: 'verification',
      title: 'Verification reminder sent',
      message: `PagerLook support sent ${request.previousCompanyName} a reminder for your employment verification.`,
      company: request.previousCompanyName,
      status: 'info',
      metadata: { verificationRequestId: request._id.toString(), event: 'verification_reminder' },
    });

    return mapVerificationRequest(request, {
      jobTitle: job.title,
      companyName: job.company,
      message: `Reminder sent to ${request.previousCompanyName} on their PagerLook dashboard.`,
    });
  }

  const { recipients, emailResult } = await performEmailResend(request, job, payload, {
    skipCooldown: true,
  });

  if (request.requestingCompanyId) {
    await createCompanyAuditLog({
      companyId: request.requestingCompanyId,
      actorUserId: adminUserId,
      employeeId: request.employeeId,
      action: 'verification_email_resent',
      entityType: 'verification_request',
      entityId: request._id,
      metadata: { emailStatus: request.emailStatus, recipients, byPlatformAdmin: true },
    });
  }

  await createActivity(request.employeeId, {
    type: 'verification',
    title: 'Verification request re-sent',
    message: `PagerLook support re-sent your verification request for ${job.company} to ${recipients.join(', ')}.`,
    company: job.company,
    status: 'info',
    metadata: {
      verificationRequestId: request._id.toString(),
      event: 'verification_reminder',
      remindersSent: request.remindersSent,
    },
  });

  return mapVerificationRequest(request, {
    jobTitle: job.title,
    companyName: job.company,
    emailSent: emailResult.sent,
    emailMock: emailResult.mock,
    recipients,
    message: emailResult.sent
      ? `Verification request re-sent to ${recipients.join(', ')}.`
      : emailResult.mock
        ? 'Mailer not configured — the email was logged in mock mode. Configure SMTP to send for real.'
        : 'Could not send the email. Check the HR addresses and try again.',
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
