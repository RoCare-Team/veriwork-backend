import { EmployeeProfile } from '../models/EmployeeProfile.js';
import { JobExperience } from '../models/JobExperience.js';
import { User } from '../models/User.js';
import { generatePublicSlug, generateVeriworkId, getInitials, normalizePhone } from '../utils/idGenerators.js';
import {
  calculateEmployeeScore,
  getScoreFactors,
  getScorePercentile,
  getScoreRating,
  getVerificationPercent,
  isVerificationComplete,
} from './scoreService.js';
import { ApiError } from '../utils/ApiError.js';

export async function getOrCreateEmployeeUser(phone) {
  const normalized = normalizePhone(phone);
  let user = await User.findOne({ phone: normalized, role: 'employee' });

  if (!user) {
    user = await User.create({ phone: normalized, role: 'employee' });
  }

  let profile = await EmployeeProfile.findOne({ userId: user._id });
  if (!profile) {
    profile = await EmployeeProfile.create({
      userId: user._id,
      phone: normalized,
      veriworkId: generateVeriworkId(),
      publicSlug: generatePublicSlug(user._id),
    });
  }

  return { user, profile };
}

export async function getJobsForUser(userId) {
  return JobExperience.find({ userId }).sort({ createdAt: -1 });
}

export async function refreshCachedScore(userId) {
  const profile = await EmployeeProfile.findOne({ userId });
  if (!profile) return null;

  const jobs = await getJobsForUser(userId);
  profile.scoreCached = calculateEmployeeScore(profile, jobs);
  await profile.save();
  return profile;
}

export function buildProfileResponse(profile, jobs = []) {
  const score = calculateEmployeeScore(profile, jobs);
  const verificationPercent = getVerificationPercent(profile);
  const verified = isVerificationComplete(profile);

  return {
    id: profile._id,
    userId: profile.userId,
    phone: profile.phone,
    name: profile.name || 'New User',
    initials: getInitials(profile.name),
    role: profile.role || 'Professional',
    company: profile.company || 'Not set',
    email: profile.email || '',
    skills: profile.skills?.length ? profile.skills : profile.role ? [profile.role] : [],
    profileSetupComplete: profile.profileSetupComplete,
    aadhaarVerified: profile.aadhaarVerified,
    biometricVerified: profile.biometricVerified,
    digilockerUsed: profile.digilockerUsed,
    photoUrl: profile.photoUrl,
    veriworkId: profile.veriworkId,
    publicSlug: profile.publicSlug,
    publicProfileUrl: `veriwork.app/u/${profile.publicSlug}`,
    endorsements: profile.endorsements || 0,
    verificationPercent,
    employeeScore: score,
    scoreRating: getScoreRating(score),
    trustScore: score,
    isVerified: verified,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

export function buildAuthEmployeePayload(user, profile, jobs = []) {
  const profileData = buildProfileResponse(profile, jobs);
  const verified = isVerificationComplete(profile);

  return {
    user: {
      id: user._id,
      phone: user.phone,
      role: user.role,
    },
    profile: profileData,
    isNewUser: !profile.profileSetupComplete,
    isWelcomeBack: verified,
    homeRoute: !profile.profileSetupComplete
      ? '/employee/profile-setup'
      : !verified
        ? '/employee/verification'
        : '/employee/score',
  };
}

export async function getEmployeeSettings(userId) {
  const profile = await EmployeeProfile.findOne({ userId });
  const user = await User.findById(userId);
  if (!profile || !user) throw ApiError.notFound('Profile not found');

  return {
    phone: profile.phone,
    email: profile.email,
    name: profile.name,
    notificationsEnabled: true,
    publicProfileEnabled: true,
    publicSlug: profile.publicSlug,
    veriworkId: profile.veriworkId,
    role: user.role,
  };
}

export async function updateEmployeeProfile(userId, data) {
  const profile = await EmployeeProfile.findOne({ userId });
  if (!profile) throw ApiError.notFound('Profile not found');

  if (data.name !== undefined) profile.name = data.name;
  if (data.role !== undefined) profile.role = data.role;
  if (data.company !== undefined) profile.company = data.company;
  if (data.email !== undefined) profile.email = data.email;
  if (data.skills !== undefined) profile.skills = data.skills;

  if (data.name && data.role) {
    profile.profileSetupComplete = true;
  }

  await profile.save();
  await refreshCachedScore(userId);
  const jobs = await getJobsForUser(userId);
  return buildProfileResponse(profile, jobs);
}

export async function getEmployeeProfile(userId) {
  const profile = await EmployeeProfile.findOne({ userId });
  if (!profile) throw ApiError.notFound('Profile not found');

  const jobs = await getJobsForUser(userId);
  return buildProfileResponse(profile, jobs);
}

export async function getEmployeeScore(userId) {
  const profile = await EmployeeProfile.findOne({ userId });
  if (!profile) throw ApiError.notFound('Profile not found');

  const jobs = await getJobsForUser(userId);
  const score = calculateEmployeeScore(profile, jobs);

  return {
    employeeScore: score,
    scoreRating: getScoreRating(score),
    percentile: getScorePercentile(score),
    factors: getScoreFactors(profile, jobs),
  };
}
