import { EmployeeProfile } from '../models/EmployeeProfile.js';
import { JobExperience } from '../models/JobExperience.js';
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
    email: profile.email || '',
    phoneMasked: maskPhone(profile.phone),
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
  const identity = decodeURIComponent(String(slug || '').trim());
  if (!identity) throw ApiError.badRequest('Profile identifier is required');

  const profile = await EmployeeProfile.findOne({
    $or: [{ publicSlug: identity }, { veriworkId: identity }],
  });

  if (!profile) throw ApiError.notFound('Profile not found');
  if (profile.publicProfileEnabled === false) {
    throw ApiError.notFound('This profile is not publicly available');
  }
  if (!profile.profileSetupComplete) {
    throw ApiError.notFound('This profile is not ready to be shared yet');
  }

  const jobs = await JobExperience.find({ userId: profile.userId }).sort({ createdAt: -1 });
  return buildPublicProfilePayload(profile, jobs);
}
