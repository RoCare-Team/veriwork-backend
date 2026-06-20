import crypto from 'crypto';
import { env } from '../config/env.js';
import { Company } from '../models/Company.js';
import { Document } from '../models/Document.js';
import { EmployeeProfile } from '../models/EmployeeProfile.js';
import { JobExperience } from '../models/JobExperience.js';
import { VerificationRequest } from '../models/VerificationRequest.js';
import { ApiError } from '../utils/ApiError.js';
import { assertValidObjectId } from '../utils/objectId.js';
import { createActivity } from './activityService.js';
import { refreshCachedScore } from './employeeProfileService.js';
import { sendEmploymentVerificationEmail } from './emailService.js';
import {
  computeProfileVerificationTags,
  getJobVerificationTag,
  getVerificationTagLabel,
} from './verificationTagsService.js';
import {
  COMPLETED_VERIFIED_STATUSES,
  getVerificationStatusLabel,
  markExpiredIfNeeded,
  normalizeVerificationStatus,
  OPEN_STATUSES,
} from '../utils/verificationStatusUtils.js';

const TOKEN_EXPIRY_DAYS = 14;

/** Normalize for fuzzy company name matching */
export function normalizeCompanyName(name) {
  if (!name?.trim()) return '';
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(
      /\b(pvt|ltd|limited|llc|inc|corp|corporation|services|service|india|private|co|company)\b/gi,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

export async function findPreviousCompanyByName(companyName, excludeCompanyId = null) {
  if (!companyName?.trim()) return null;

  const baseFilter = excludeCompanyId ? { _id: { $ne: excludeCompanyId } } : {};

  const escaped = companyName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exact = await Company.findOne({
    ...baseFilter,
    name: { $regex: new RegExp(`^${escaped}$`, 'i') },
  });
  if (exact) return exact;

  const normalizedInput = normalizeCompanyName(companyName);
  if (!normalizedInput || normalizedInput.length < 2) return null;

  const companies = await Company.find(baseFilter).select('name').limit(500);

  const exactNormalized = companies.find((c) => normalizeCompanyName(c.name) === normalizedInput);
  if (exactNormalized) return Company.findById(exactNormalized._id);

  const containsMatch = companies.find((c) => {
    const n = normalizeCompanyName(c.name);
    if (n.length < 2 || normalizedInput.length < 2) return false;
    return n.includes(normalizedInput) || normalizedInput.includes(n);
  });
  if (containsMatch) return Company.findById(containsMatch._id);

  return null;
}

export async function searchPlatformCompanies(query, excludeCompanyId = null, limit = 10) {
  const q = query?.trim();
  if (!q || q.length < 2) return [];

  const baseFilter = excludeCompanyId ? { _id: { $ne: excludeCompanyId } } : {};
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const normalizedQ = normalizeCompanyName(q);

  const byRegex = await Company.find({
    ...baseFilter,
    name: { $regex: new RegExp(escaped, 'i') },
  })
    .select('name industry city')
    .limit(limit);

  if (byRegex.length >= limit) {
    return byRegex.map((c) => ({ id: c._id.toString(), name: c.name, industry: c.industry, city: c.city }));
  }

  const all = await Company.find(baseFilter).select('name industry city').limit(200);
  const seen = new Set(byRegex.map((c) => c._id.toString()));
  const fuzzy = all.filter((c) => {
    if (seen.has(c._id.toString())) return false;
    const n = normalizeCompanyName(c.name);
    return n.includes(normalizedQ) || normalizedQ.includes(n);
  });

  return [...byRegex, ...fuzzy]
    .slice(0, limit)
    .map((c) => ({ id: c._id.toString(), name: c.name, industry: c.industry, city: c.city }));
}

export function generateExternalToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function mapVerificationRequest(request, extras = {}) {
  const tag = request.verificationLevel
    ? { id: request.verificationLevel, label: getVerificationTagLabel(request.verificationLevel) }
    : null;

  const normalizedStatus = normalizeVerificationStatus(request.status, request.verificationResult);
  const details = request.employmentDetails || {};

  return {
    id: request._id,
    initiatedBy: request.initiatedBy,
    employeeId: request.employeeId,
    jobExperienceId: request.jobExperienceId,
    previousCompanyName: request.previousCompanyName,
    verificationChannel: request.verificationChannel,
    verificationLevel: request.verificationLevel,
    verificationTag: tag,
    hrEmail: request.hrEmail,
    managerEmail: request.managerEmail,
    hrName: request.hrName,
    status: normalizedStatus,
    statusLabel: getVerificationStatusLabel(request.status),
    rawStatus: request.status,
    verificationResult: request.verificationResult,
    employmentDetails: details,
    rehireEligible: details.rehireEligible ?? null,
    verificationNotes: details.verificationNotes || request.notes || '',
    requestedAt: request.requestedAt || request.createdAt,
    respondedAt: request.respondedAt,
    resolvedVia: request.resolvedVia,
    ...extras,
  };
}

export const PERMANENT_VERIFICATION_LEVELS = ['document_verified', 'hr_verified', 'employer_verified'];

export function isPermanentlyVerifiedJob(job) {
  if (!job) return false;
  return job.status === 'verified' || PERMANENT_VERIFICATION_LEVELS.includes(job.verificationLevel);
}

export function computeDocumentConfidenceScore(documentCount) {
  if (documentCount <= 0) return 0;
  if (documentCount === 1) return 55;
  if (documentCount === 2) return 70;
  if (documentCount === 3) return 82;
  return Math.min(92, 85 + (documentCount - 4) * 2);
}

export function buildPermanentVerificationRecord(job, request = null) {
  const details = request?.employmentDetails || {};
  const level = job.verificationLevel;

  return {
    jobExperienceId: job._id,
    company: job.company,
    title: job.title,
    employmentType: details.employmentType || job.employmentType || '',
    joiningDate: details.joiningDate || job.joiningDate || '',
    exitDate: details.exitDate || job.exitDate || '',
    duration: details.duration || job.duration || '',
    verificationLevel: level,
    verificationTag: getJobVerificationTag(job),
    verifiedAt: job.verifiedAt,
    confidenceScore: job.confidenceScore,
    rehireEligible: details.rehireEligible ?? job.rehireEligible ?? null,
    verificationFeedback: details.feedback || job.verificationFeedback || '',
    verificationNotes: details.verificationNotes || job.verificationNotes || '',
    resolvedVia: request?.resolvedVia || null,
    isReusable: PERMANENT_VERIFICATION_LEVELS.includes(level),
    verifiedBy: level === 'employer_verified'
      ? 'employer_platform'
      : level === 'hr_verified'
        ? 'hr_email'
        : level === 'document_verified'
          ? 'document_fallback'
          : null,
  };
}

export async function getPermanentVerificationRecordForJob(jobExperienceId) {
  const job = await JobExperience.findById(jobExperienceId);
  if (!job || !isPermanentlyVerifiedJob(job)) return null;

  const request = await getExistingApprovedVerification(jobExperienceId);
  return buildPermanentVerificationRecord(job, request);
}

export async function getExistingApprovedVerification(jobExperienceId) {
  return VerificationRequest.findOne({
    jobExperienceId,
    status: { $in: COMPLETED_VERIFIED_STATUSES },
    verificationResult: 'verified',
  }).sort({ respondedAt: -1 });
}

export async function processEmployeeDocumentFallbacks(employeeId) {
  const requests = await VerificationRequest.find({
    employeeId,
    verificationChannel: 'email',
    status: { $in: [...OPEN_STATUSES, 'expired'] },
    externalTokenExpiresAt: { $lte: new Date() },
    resolvedVia: { $ne: 'document_fallback' },
  });

  for (const request of requests) {
    await maybeApplyDocumentFallback(request);
  }
}

export async function maybeApplyDocumentFallback(request, { force = false } = {}) {
  if (!request || request.verificationChannel !== 'email') return null;
  if (request.resolvedVia === 'document_fallback' && !force) return null;
  if (['verified', 'rejected'].includes(request.status) && !force) return null;

  const expired = request.externalTokenExpiresAt && request.externalTokenExpiresAt <= new Date();
  if (!force && !expired && request.status !== 'expired') return null;

  const job = await JobExperience.findById(request.jobExperienceId);
  if (!job) return null;
  if (['hr_verified', 'employer_verified'].includes(job.verificationLevel)) return null;

  const docCount = await Document.countDocuments({ userId: request.employeeId, jobId: job._id });
  if (docCount === 0) {
    if (!force && request.status !== 'expired') {
      request.status = 'expired';
      await request.save();
    }
    return null;
  }

  const confidenceScore = computeDocumentConfidenceScore(docCount);
  job.status = 'verified';
  job.verificationLevel = 'document_verified';
  job.confidenceScore = confidenceScore;
  job.verifiedAt = job.verifiedAt || new Date();
  await job.save();

  request.status = 'verified';
  request.verificationResult = 'verified';
  request.verificationLevel = 'document_verified';
  request.resolvedVia = force ? 'company_review' : 'document_fallback';
  request.respondedAt = new Date();
  request.scoreImpactApplied = true;
  request.notes = `${request.notes || ''} ${force ? 'Verified by requesting company using submitted documents.' : 'Completed via document fallback (no HR response).'}`.trim();
  await request.save();

  await refreshCachedScore(job.userId, 'verification');
  await notifyEmployeeVerificationComplete(request.employeeId, job, 'document_verified');

  return buildPermanentVerificationRecord(job, request);
}

export async function applyVerificationResult(job, result, {
  verificationLevel = null,
  employmentDetails = {},
  feedback = '',
} = {}) {
  if (result === 'verified') {
    job.status = 'verified';
    job.verificationLevel = verificationLevel || 'employer_verified';
    job.verifiedAt = new Date();
    if (employmentDetails.designation) job.title = employmentDetails.designation;
    if (employmentDetails.joiningDate) job.joiningDate = employmentDetails.joiningDate;
    if (employmentDetails.exitDate) job.exitDate = employmentDetails.exitDate;
    if (employmentDetails.duration) job.duration = employmentDetails.duration;
    if (feedback || employmentDetails.feedback) {
      job.verificationFeedback = feedback || employmentDetails.feedback;
    }
    if (employmentDetails.rehireEligible !== undefined && employmentDetails.rehireEligible !== null) {
      job.rehireEligible = employmentDetails.rehireEligible;
    }
    if (employmentDetails.verificationNotes) {
      job.verificationNotes = employmentDetails.verificationNotes;
    }
    if (employmentDetails.employmentType) {
      job.employmentType = employmentDetails.employmentType;
    }
    if (employmentDetails.confidenceScore != null) {
      job.confidenceScore = employmentDetails.confidenceScore;
    }
  } else if (result === 'rejected') {
    job.status = 'not_verified';
    job.verificationLevel = 'none';
  } else {
    job.status = 'in_process';
  }

  await job.save();
  await refreshCachedScore(job.userId, 'verification');
  return job;
}

export async function notifyEmployeeVerificationComplete(employeeId, job, verificationLevel) {
  const tagLabel = getVerificationTagLabel(verificationLevel);
  await createActivity(employeeId, {
    type: 'verification',
    title: 'Employment verified',
    message: `Your employment at ${job.company} has been ${tagLabel}.`,
    company: job.company,
    status: 'info',
    metadata: {
      jobExperienceId: job._id.toString(),
      verificationLevel,
      verificationTag: tagLabel,
      event: 'verification_complete',
    },
  });
}

export async function resolveVerificationLevel(verificationChannel, workedHere = true) {
  if (!workedHere) return null;
  return verificationChannel === 'platform' ? 'employer_verified' : 'hr_verified';
}

async function createVerificationRequestRecord({
  initiatedBy,
  requestingCompanyId,
  targetCompanyId,
  employeeId,
  jobExperienceId,
  previousCompanyName,
  verificationChannel,
  hrEmail,
  managerEmail,
  hrName,
  requestedBy,
  status,
  notes,
}) {
  const externalToken = verificationChannel === 'email' ? generateExternalToken() : null;
  const externalTokenExpiresAt = externalToken
    ? new Date(Date.now() + TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
    : null;

  return VerificationRequest.create({
    initiatedBy,
    requestingCompanyId: requestingCompanyId || null,
    targetCompanyId: targetCompanyId || null,
    employeeId,
    jobExperienceId,
    previousCompanyName,
    verificationChannel,
    hrEmail: hrEmail || '',
    managerEmail: managerEmail || '',
    hrName: hrName || '',
    status,
    requestedBy,
    requestedAt: new Date(),
    notes,
    externalToken,
    externalTokenExpiresAt,
  });
}

export async function sendVerificationEmails(request, job, employeeProfile) {
  const recipients = [request.hrEmail, request.managerEmail].filter(Boolean);
  if (recipients.length === 0) return { sent: false, mock: true };

  const results = await Promise.all(
    recipients.map((to) => sendEmploymentVerificationEmail({
      to,
      employeeName: employeeProfile?.name || 'Employee',
      previousCompanyName: job.company,
      designation: job.title,
      duration: job.duration,
      verificationLink: request.externalToken
        ? `${env.frontendUrl}/verify-employment/${request.externalToken}`
        : null,
      isPlatformCompany: request.verificationChannel === 'platform',
    })),
  );

  return {
    sent: results.some((r) => r.sent),
    mock: results.every((r) => r.mock),
    recipients,
  };
}

export async function createEmployeeVerificationRequest(userId, jobId, payload) {
  const validJobId = assertValidObjectId(jobId, 'job id');
  const job = await JobExperience.findOne({ _id: validJobId, userId });
  if (!job) throw ApiError.notFound('Job not found');

  const existingApproved = await getExistingApprovedVerification(job._id);
  if (existingApproved || job.status === 'verified') {
    return {
      alreadyVerified: true,
      verificationTag: getJobVerificationTag(job),
      request: mapVerificationRequest(existingApproved || await VerificationRequest.findOne({
        jobExperienceId: job._id,
        status: 'approved',
      })),
      message: 'This employment is already verified. No new request needed.',
    };
  }

  const pending = await VerificationRequest.findOne({
    employeeId: userId,
    jobExperienceId: job._id,
    status: { $in: [...OPEN_STATUSES, 'pending'] },
  });
  if (pending) {
    throw ApiError.conflict('A verification request is already in progress for this job');
  }

  const documents = await Document.find({ userId, jobId: job._id });
  if (documents.length === 0) {
    throw ApiError.badRequest(
      'Upload at least one employment document (offer letter, salary slip, experience letter, or relieving letter) before requesting verification',
    );
  }

  const hrEmail = payload.hrEmail || job.hrEmail || '';
  const managerEmail = payload.managerEmail || job.managerEmail || job.companyEmail || '';

  if (hrEmail) job.hrEmail = hrEmail;
  if (managerEmail) job.managerEmail = managerEmail;
  if (job.status !== 'verified' && job.status !== 'in_process') {
    job.status = 'in_process';
  }
  await job.save();

  const previousCompany = await findPreviousCompanyByName(job.company);
  const verificationChannel = previousCompany ? 'platform' : 'email';

  if (verificationChannel === 'email' && !hrEmail && !managerEmail) {
    throw ApiError.badRequest('HR email or manager email is required when company is not on PagerLook');
  }

  const profile = await EmployeeProfile.findOne({ userId }).select('name');

  const verificationRequest = await createVerificationRequestRecord({
    initiatedBy: 'employee',
    requestingCompanyId: null,
    targetCompanyId: previousCompany?._id || null,
    employeeId: userId,
    jobExperienceId: job._id,
    previousCompanyName: job.company,
    verificationChannel,
    hrEmail,
    managerEmail,
    hrName: payload.hrName || '',
    requestedBy: userId,
    status: verificationChannel === 'platform' ? 'pending' : 'in_review',
    notes: verificationChannel === 'platform'
      ? 'Self-initiated verification sent to previous company dashboard'
      : 'Self-initiated verification email sent to HR/Manager',
  });

  let emailResult = { sent: false, mock: true };
  if (verificationChannel === 'email') {
    emailResult = await sendVerificationEmails(verificationRequest, job, profile);
  }

  await createActivity(userId, {
    type: 'verification',
    title: 'Verification request sent',
    message: `Verification request for ${job.company} has been submitted.`,
    company: job.company,
    status: 'info',
    metadata: {
      verificationRequestId: verificationRequest._id.toString(),
      verificationChannel,
      event: 'verification_request',
    },
  });

  return {
    alreadyVerified: false,
    request: mapVerificationRequest(verificationRequest, {
      previousCompanyRegistered: Boolean(previousCompany),
      emailSent: emailResult.sent,
      emailMock: emailResult.mock,
      message: verificationChannel === 'platform'
        ? 'Request sent to previous company dashboard on PagerLook'
        : 'Verification request sent to HR/Manager email',
    }),
  };
}

export async function listEmployeeVerificationRequests(userId) {
  await processEmployeeDocumentFallbacks(userId);

  const requests = await VerificationRequest.find({ employeeId: userId })
    .sort({ createdAt: -1 });

  const companyIds = [
    ...new Set(
      requests.flatMap((r) => [r.requestingCompanyId?.toString(), r.targetCompanyId?.toString()]).filter(Boolean),
    ),
  ];
  const jobIds = [...new Set(requests.map((r) => r.jobExperienceId?.toString()).filter(Boolean))];

  const [companies, jobs] = await Promise.all([
    Company.find({ _id: { $in: companyIds } }).select('name'),
    JobExperience.find({ _id: { $in: jobIds } }).select('title company'),
  ]);
  const companyMap = new Map(companies.map((c) => [c._id.toString(), c.name]));
  const jobMap = new Map(jobs.map((j) => [j._id.toString(), j]));

  return {
    summary: {
      total: requests.length,
      approved: requests.filter((r) => COMPLETED_VERIFIED_STATUSES.includes(r.status)).length,
      pending: requests.filter((r) => OPEN_STATUSES.includes(r.status) || r.status === 'pending').length,
      awaitingConsent: requests.filter((r) => r.status === 'pending_employee_consent').length,
      inReview: requests.filter((r) => r.status === 'in_review' || r.status === 'in_process').length,
      expired: requests.filter((r) => r.status === 'expired').length,
      rejected: requests.filter((r) => r.status === 'rejected').length,
    },
    requests: requests.map((request) => {
      const job = jobMap.get(request.jobExperienceId?.toString());
      return mapVerificationRequest(request, {
        requestingCompanyName: companyMap.get(request.requestingCompanyId?.toString()) || '',
        targetCompanyName: companyMap.get(request.targetCompanyId?.toString()) || request.previousCompanyName,
        jobTitle: job?.title || '',
        companyName: job?.company || request.previousCompanyName,
      });
    }),
  };
}

export async function getJobVerificationStatus(userId, jobId) {
  const validJobId = assertValidObjectId(jobId, 'job id');

  await processEmployeeDocumentFallbacks(userId);

  const job = await JobExperience.findOne({ _id: validJobId, userId });
  if (!job) throw ApiError.notFound('Job not found');

  const [documents, requests, approvedRequest] = await Promise.all([
    Document.find({ userId, jobId: job._id }).sort({ createdAt: -1 }),
    VerificationRequest.find({ employeeId: userId, jobExperienceId: job._id })
      .sort({ createdAt: -1 }),
    getExistingApprovedVerification(job._id),
  ]);

  return {
    job: {
      id: job._id,
      company: job.company,
      title: job.title,
      status: job.status,
      verificationLevel: job.verificationLevel,
      verificationTag: getJobVerificationTag(job),
      verifiedAt: job.verifiedAt,
      verificationFeedback: job.verificationFeedback,
      hrEmail: job.hrEmail,
      managerEmail: job.managerEmail,
    },
    documents: documents.map((doc) => ({
      id: doc._id,
      documentType: doc.documentType || 'other',
      originalName: doc.originalName,
      status: doc.status,
      url: doc.url,
      createdAt: doc.createdAt,
    })),
    verificationRequests: requests.map((request) => mapVerificationRequest(request)),
    isVerified: job.status === 'verified',
    alreadyVerified: Boolean(approvedRequest),
    canRequestVerification: job.status !== 'verified'
      && !requests.some((r) => OPEN_STATUSES.includes(r.status) || r.status === 'pending'),
    requiredDocuments: [
      'offer_letter',
      'salary_slip',
      'experience_letter',
      'relieving_letter',
    ],
    permanentRecord: isPermanentlyVerifiedJob(job)
      ? buildPermanentVerificationRecord(job, approvedRequest)
      : null,
  };
}

export async function getVerificationTags(userId) {
  const [profile, jobs, documents] = await Promise.all([
    EmployeeProfile.findOne({ userId }),
    JobExperience.find({ userId }),
    Document.find({ userId }),
  ]);

  if (!profile) throw ApiError.notFound('Employee profile not found');

  const hierarchy = computeProfileVerificationTags(profile, jobs, documents);

  return {
    ...hierarchy,
    jobs: jobs.map((job) => ({
      id: job._id,
      company: job.company,
      title: job.title,
      status: job.status,
      verificationLevel: job.verificationLevel,
      verificationTag: getJobVerificationTag(job),
      verifiedAt: job.verifiedAt,
    })),
  };
}

export async function getPublicVerificationByToken(token) {
  if (!token?.trim()) throw ApiError.badRequest('Verification token is required');

  const request = await VerificationRequest.findOne({ externalToken: token.trim() });
  if (!request) throw ApiError.notFound('Verification request not found or expired');

  await markExpiredIfNeeded(request);

  if (request.status === 'expired') {
    const fallback = await maybeApplyDocumentFallback(request);
    if (fallback) {
      throw ApiError.badRequest(
        'Verification link expired. Employment was verified using submitted documents.',
      );
    }
    throw ApiError.badRequest('Verification link has expired');
  }

  if (!OPEN_STATUSES.includes(request.status) && request.status !== 'pending') {
    throw ApiError.badRequest('This verification request has already been processed');
  }

  const [job, profile] = await Promise.all([
    JobExperience.findById(request.jobExperienceId),
    EmployeeProfile.findOne({ userId: request.employeeId }).select('name veriworkId'),
  ]);

  return {
    requestId: request._id,
    employeeName: profile?.name || 'Employee',
    employeePagerlookId: profile?.veriworkId || '',
    previousCompanyName: request.previousCompanyName,
    designation: job?.title || '',
    joiningDate: job?.joiningDate || '',
    exitDate: job?.exitDate || '',
    duration: job?.duration || '',
    status: request.status,
    expiresAt: request.externalTokenExpiresAt,
  };
}

export async function respondToPublicVerification(token, payload) {
  if (!token?.trim()) throw ApiError.badRequest('Verification token is required');

  const request = await VerificationRequest.findOne({ externalToken: token.trim() });
  if (!request) throw ApiError.notFound('Verification request not found or expired');

  await markExpiredIfNeeded(request);

  if (request.status === 'expired') {
    const fallback = await maybeApplyDocumentFallback(request);
    if (fallback) {
      throw ApiError.badRequest(
        'Verification link expired. Employment was verified using submitted documents.',
      );
    }
    throw ApiError.badRequest('Verification link has expired');
  }

  if (!OPEN_STATUSES.includes(request.status) && request.status !== 'pending') {
    throw ApiError.badRequest('This verification request has already been processed');
  }

  const workedHere = payload.workedHere === true;
  const approved = workedHere;
  const verificationLevel = await resolveVerificationLevel(request.verificationChannel, workedHere);
  const isCompanyInitiated = request.initiatedBy === 'company' && request.requestingCompanyId;

  request.employmentDetails = {
    workedHere,
    designation: payload.designation || '',
    joiningDate: payload.joiningDate || '',
    exitDate: payload.exitDate || '',
    duration: payload.duration || '',
    feedback: payload.feedback || '',
    rehireEligible: payload.rehireEligible ?? null,
    verificationNotes: payload.verificationNotes || payload.feedback || '',
    employmentType: payload.employmentType || '',
  };
  request.resolvedVia = 'hr_response';
  request.respondedAt = new Date();
  request.notes = payload.feedback || request.notes;

  if (isCompanyInitiated && approved) {
    request.status = 'hr_responded';
    request.verificationResult = null;
    request.verificationLevel = null;
    request.scoreImpactApplied = false;
    await request.save();

    const job = await JobExperience.findById(request.jobExperienceId);
    if (job) {
      job.status = 'in_process';
      await job.save();
    }

    await createActivity(request.employeeId, {
      type: 'verification',
      title: 'HR responded to verification',
      message: `Previous employer HR submitted feedback for ${request.previousCompanyName}. Awaiting new company review.`,
      company: request.previousCompanyName,
      status: 'info',
      metadata: {
        verificationRequestId: request._id.toString(),
        event: 'hr_responded',
      },
    });

    return {
      success: true,
      verificationResult: 'hr_responded',
      verificationTag: null,
      message: 'HR feedback submitted. The requesting company will review before final verification.',
    };
  }

  request.status = approved ? 'verified' : 'rejected';
  request.verificationResult = approved ? 'verified' : 'rejected';
  request.verificationLevel = verificationLevel;
  request.scoreImpactApplied = true;
  await request.save();

  const job = await JobExperience.findById(request.jobExperienceId);
  if (job) {
    await applyVerificationResult(job, request.verificationResult, {
      verificationLevel: verificationLevel || 'none',
      employmentDetails: request.employmentDetails,
    });

    if (approved && verificationLevel) {
      await notifyEmployeeVerificationComplete(request.employeeId, job, verificationLevel);
    }
  }

  return {
    success: true,
    verificationResult: request.verificationResult,
    verificationTag: verificationLevel
      ? { id: verificationLevel, label: getVerificationTagLabel(verificationLevel) }
      : null,
    message: approved
      ? 'Employment verification completed successfully'
      : 'Employment verification marked as not confirmed',
  };
}

export async function completePlatformVerificationResponse(request, {
  status,
  verificationResult,
  respondedBy,
  employmentDetails = {},
}) {
  const workedHere = employmentDetails.workedHere !== false;
  const verificationLevel = verificationResult === 'verified'
    ? 'employer_verified'
    : null;

  request.status = verificationResult === 'verified' ? 'verified' : 'rejected';
  request.verificationResult = verificationResult;
  request.verificationLevel = verificationLevel;
  request.employmentDetails = {
    workedHere,
    designation: employmentDetails.designation || '',
    joiningDate: employmentDetails.joiningDate || '',
    exitDate: employmentDetails.exitDate || '',
    duration: employmentDetails.duration || '',
    feedback: employmentDetails.feedback || '',
    rehireEligible: employmentDetails.rehireEligible ?? null,
    verificationNotes: employmentDetails.verificationNotes || employmentDetails.feedback || '',
    employmentType: employmentDetails.employmentType || '',
  };
  request.resolvedVia = 'employer_platform';
  request.respondedBy = respondedBy;
  request.respondedAt = new Date();
  request.scoreImpactApplied = true;
  await request.save();

  const job = await JobExperience.findById(request.jobExperienceId);
  if (job) {
    await applyVerificationResult(job, verificationResult, {
      verificationLevel: verificationLevel || 'none',
      employmentDetails: request.employmentDetails,
      feedback: employmentDetails.feedback,
    });

    if (verificationResult === 'verified') {
      await notifyEmployeeVerificationComplete(
        request.employeeId,
        job,
        verificationLevel,
      );
    }
  }

  return request;
}
