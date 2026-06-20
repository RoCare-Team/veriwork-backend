import { EmployeeProfile } from '../models/EmployeeProfile.js';
import { JobExperience } from '../models/JobExperience.js';
import { ActivityLog } from '../models/ActivityLog.js';
import { PublicProfileAccessRequest } from '../models/PublicProfileAccessRequest.js';
import { ApiError } from '../utils/ApiError.js';
import { getInitials } from '../utils/idGenerators.js';
import {
  calculateEmployeeScore,
  getScoreRating,
  getVerificationPercent,
  isVerificationComplete,
} from './scoreService.js';
import { computeProfileVerificationTags, getJobVerificationTag } from './verificationTagsService.js';
import { buildPublicProfileUrl } from '../utils/publicProfileUrl.js';

function maskPhone(phone = '') {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '';
  return `+${digits.slice(0, 2)}******${digits.slice(-4)}`;
}

function formatPublicJob(job) {
  const tag = getJobVerificationTag(job);
  return {
    id: job._id,
    title: job.title,
    company: job.company,
    employmentType: job.employmentType || 'Full-time',
    duration: job.duration,
    joiningDate: job.joiningDate,
    exitDate: job.exitDate,
    isPresent: job.isPresent,
    description: job.description || '',
    status: job.status,
    verificationLevel: job.verificationLevel || 'none',
    verificationTag: tag,
    verifiedAt: job.verifiedAt,
    statusLabel: job.status === 'verified' ? tag.label : job.status === 'in_process' ? 'In Process' : 'Not Verified',
  };
}

function buildPublicProfilePayload(profile, jobs) {
  const score = calculateEmployeeScore(profile, jobs);
  const verifiedJobsCount = jobs.filter((j) => j.status === 'verified' || j.verificationLevel !== 'none').length;
  const hierarchy = computeProfileVerificationTags(profile, jobs);

  return {
    name: profile.name || 'Professional',
    initials: getInitials(profile.name),
    role: profile.role || 'Professional',
    company: profile.company || '',
    totalExperience: profile.totalExperience || '',
    currentCity: profile.currentCity || '',
    emailMasked: maskEmail(profile.email),
    phoneMasked: maskPhone(profile.phone),
    hasFullAccessAvailable: true,
    photoUrl: profile.photoUrl,
    veriworkId: profile.veriworkId,
    publicSlug: profile.publicSlug,
    publicProfileUrl: buildPublicProfileUrl(profile),
    skills: profile.skills?.length ? profile.skills : profile.role ? [profile.role] : [],
    employeeScore: score,
    trustScore: score,
    scoreRating: getScoreRating(score),
    endorsements: profile.endorsements || 0,
    verifiedJobsCount,
    totalJobsCount: jobs.length,
    verificationPercent: getVerificationPercent(profile),
    isVerified: isVerificationComplete(profile),
    verificationTags: hierarchy.tags,
    highestVerificationLevel: hierarchy.highestLevel,
    identityVerified: profile.aadhaarVerified && profile.biometricVerified,
    profileSetupComplete: profile.profileSetupComplete,
    jobs: jobs.map(formatPublicJob),
  };
}

export async function getPublicProfileBySlug(slug) {
  const profile = await findPublicProfile(slug);
  const jobs = await JobExperience.find({ userId: profile.userId }).sort({ createdAt: -1 });
  return buildPublicProfilePayload(profile, jobs);
}

export async function requestPublicFullProfileAccess(slug, payload) {
  const profile = await findPublicProfile(slug);
  const requesterEmail = payload.requesterEmail.trim().toLowerCase();

  const existing = await PublicProfileAccessRequest.findOne({
    employeeUserId: profile.userId,
    requesterEmail,
    status: 'pending',
  });
  if (existing) {
    throw ApiError.conflict('You already have a pending access request for this profile');
  }

  const accessRequest = await PublicProfileAccessRequest.create({
    employeeUserId: profile.userId,
    employeeName: profile.name || '',
    publicSlug: profile.publicSlug,
    requesterName: payload.requesterName.trim(),
    requesterEmail,
    reason: payload.reason.trim(),
    status: 'pending',
  });

  await ActivityLog.create({
    userId: profile.userId,
    type: 'access_request',
    title: 'Full profile access request',
    message: `${payload.requesterName.trim()} (${requesterEmail}) requested full profile access: ${payload.reason.trim()}`,
    company: payload.requesterName.trim(),
    status: 'pending',
    metadata: {
      source: 'public_profile',
      publicProfileAccessRequestId: accessRequest._id.toString(),
      requesterName: payload.requesterName.trim(),
      requesterEmail,
      reason: payload.reason.trim(),
      publicSlug: profile.publicSlug,
    },
  });

  return {
    message: 'Access request sent. The professional will review your request.',
    status: 'pending',
  };
}
