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
import { computeProfileVerificationTags } from './verificationTagsService.js';
import { ApiError } from '../utils/ApiError.js';
import { storeUploadedFile } from '../utils/fileUpload.js';
import { autoJoinAfterProfileSetup } from './invitationService.js';
import { buildPublicProfileUrl } from '../utils/publicProfileUrl.js';

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

export async function getOrCreateEmployeeByGoogle({ googleId, email, name, picture }) {
  let user = await User.findOne({ googleId, role: 'employee' });

  if (!user && email) {
    user = await User.findOne({ email, role: 'employee' });
    if (user) {
      user.googleId = googleId;
      user.authProvider = 'google';
      await user.save();
    }
  }

  if (!user) {
    user = await User.create({
      googleId,
      email,
      role: 'employee',
      authProvider: 'google',
    });
  }

  let profile = await EmployeeProfile.findOne({ userId: user._id });
  if (!profile) {
    profile = await EmployeeProfile.create({
      userId: user._id,
      phone: user.phone || `google_${googleId}`,
      email: email || '',
      name: name || '',
      photoUrl: picture,
      veriworkId: generateVeriworkId(),
      publicSlug: generatePublicSlug(user._id),
    });
  } else {
    if (name && !profile.name) profile.name = name;
    if (email && !profile.email) profile.email = email;
    if (picture && !profile.photoUrl) profile.photoUrl = picture;
    await profile.save();
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
  const verifiedJobsCount = jobs.filter((job) => job.status === 'verified').length;

  return {
    id: profile._id,
    userId: profile.userId,
    name: profile.name || 'New User',
    phone: profile.phone || '',
    email: profile.email || '',
    dateOfBirth: profile.dateOfBirth || '',
    gender: profile.gender || '',
    role: profile.role || 'Professional',
    company: profile.company || 'Not set',
    totalExperience: profile.totalExperience || '',
    currentCity: profile.currentCity || '',
    currentAddress: profile.currentAddress || '',
    permanentAddress: profile.permanentAddress || '',
    initials: getInitials(profile.name),
    skills: profile.skills?.length ? profile.skills : profile.role ? [profile.role] : [],
    profileSetupComplete: profile.profileSetupComplete,
    aadhaarVerified: profile.aadhaarVerified,
    biometricVerified: profile.biometricVerified,
    digilockerUsed: profile.digilockerUsed,
    photoUrl: profile.photoUrl,
    veriworkId: profile.veriworkId,
    publicSlug: profile.publicSlug,
    publicProfileUrl: buildPublicProfileUrl(profile),
    endorsements: profile.endorsements || 0,
    verifiedJobsCount,
    totalJobsCount: jobs.length,
    verificationPercent,
    employeeScore: score,
    scoreRating: getScoreRating(score),
    trustScore: score,
    isVerified: verified,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function isProfileFieldsComplete(profile) {
  return Boolean(
    profile.name?.trim()
    && profile.phone?.trim()
    && profile.email?.trim()
    && profile.dateOfBirth?.trim()
    && profile.gender?.trim()
    && profile.role?.trim()
    && profile.company?.trim()
    && profile.totalExperience?.trim()
    && profile.currentCity?.trim()
    && profile.currentAddress?.trim()
    && profile.permanentAddress?.trim(),
  );
}

export async function updateEmployeeProfile(userId, data, photoFile = null) {
  const profile = await EmployeeProfile.findOne({ userId });
  if (!profile) throw ApiError.notFound('Profile not found');

  const user = await User.findById(userId);

  if (data.name !== undefined) profile.name = data.name.trim();
  if (data.email !== undefined) profile.email = data.email.trim().toLowerCase();
  if (data.dateOfBirth !== undefined) profile.dateOfBirth = data.dateOfBirth;
  if (data.gender !== undefined) profile.gender = data.gender;
  if (data.role !== undefined) profile.role = data.role.trim();
  if (data.company !== undefined) profile.company = data.company.trim();
  if (data.totalExperience !== undefined) profile.totalExperience = data.totalExperience.trim();
  if (data.currentCity !== undefined) profile.currentCity = data.currentCity.trim();
  if (data.currentAddress !== undefined) profile.currentAddress = data.currentAddress.trim();
  if (data.permanentAddress !== undefined) profile.permanentAddress = data.permanentAddress.trim();
  if (data.skills !== undefined) profile.skills = data.skills;

  if (data.phone !== undefined) {
    const normalized = normalizePhone(data.phone);
    const phoneTaken = await User.findOne({
      phone: normalized,
      role: 'employee',
      _id: { $ne: userId },
    });
    if (phoneTaken) throw ApiError.conflict('This mobile number is already registered');

    profile.phone = normalized;
    if (user) {
      user.phone = normalized;
      await user.save();
    }
  }

  if (photoFile) {
    const stored = await storeUploadedFile(photoFile, 'profile/photos');
    profile.photoUrl = stored.url;
  }

  profile.profileSetupComplete = isProfileFieldsComplete(profile);

  await profile.save();
  await refreshCachedScore(userId);
  const jobs = await getJobsForUser(userId);
  const profileData = buildProfileResponse(profile, jobs);

  let invitationResult = null;
  if (profile.profileSetupComplete) {
    invitationResult = await autoJoinAfterProfileSetup(userId, {
      invitationToken: data.invitationToken,
    });
  }

  return {
    ...profileData,
    nextRoute: profile.profileSetupComplete ? '/employee/verification' : '/employee/profile-setup',
    invitationResult,
  };
}

export async function setupEmployeeProfile(userId, data, photoFile = null) {
  return updateEmployeeProfile(userId, data, photoFile);
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
    dateOfBirth: profile.dateOfBirth,
    gender: profile.gender,
    role: profile.role,
    company: profile.company,
    totalExperience: profile.totalExperience,
    currentCity: profile.currentCity,
    currentAddress: profile.currentAddress,
    permanentAddress: profile.permanentAddress,
    photoUrl: profile.photoUrl,
    notificationsEnabled: profile.notificationsEnabled ?? true,
    publicProfileEnabled: profile.publicProfileEnabled ?? true,
    publicSlug: profile.publicSlug,
    veriworkId: profile.veriworkId,
    userRole: user.role,
    language: profile.language || 'en-US',
  };
}

export async function updateEmployeeSettings(userId, data) {
  const profile = await EmployeeProfile.findOne({ userId });
  if (!profile) throw ApiError.notFound('Profile not found');

  if (data.notificationsEnabled !== undefined) {
    profile.notificationsEnabled = data.notificationsEnabled;
  }
  if (data.publicProfileEnabled !== undefined) {
    profile.publicProfileEnabled = data.publicProfileEnabled;
  }
  if (data.language !== undefined) {
    profile.language = data.language;
  }

  await profile.save();

  return getEmployeeSettings(userId);
}

export async function getProfessionalId(userId) {
  const profile = await EmployeeProfile.findOne({ userId });
  if (!profile) throw ApiError.notFound('Profile not found');

  const jobs = await getJobsForUser(userId);
  const profileData = buildProfileResponse(profile, jobs);

  return {
    name: profileData.name,
    role: profileData.role,
    photoUrl: profileData.photoUrl,
    initials: profileData.initials,
    veriworkId: profileData.veriworkId,
    publicSlug: profileData.publicSlug,
    publicProfileUrl: profileData.publicProfileUrl,
    employeeScore: profileData.employeeScore,
    trustScore: profileData.trustScore,
    scoreRating: profileData.scoreRating,
    endorsements: profileData.endorsements,
    skills: profileData.skills,
    verifiedJobsCount: profileData.verifiedJobsCount,
    totalJobsCount: profileData.totalJobsCount,
    isVerified: profileData.isVerified,
  };
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
  const factors = getScoreFactors(profile, jobs);
  const hierarchy = computeProfileVerificationTags(profile, jobs);
  const endorsementFactor = factors.find((f) => f.id === 'endorsements');

  return {
    employeeScore: score,
    veriScore: score,
    trustScore: score,
    minScore: 300,
    maxScore: 1000,
    scoreRating: getScoreRating(score),
    percentile: getScorePercentile(score),
    factors,
    verificationHierarchy: hierarchy,
    verificationTags: hierarchy.tags,
    highestVerificationLevel: hierarchy.highestLevel,
    endorsements: {
      count: profile.endorsements || 0,
      maxCount: 8,
      points: endorsementFactor?.points || 0,
      maxPoints: endorsementFactor?.max || 60,
      pointsPerEndorsement: 8,
      tip: endorsementFactor?.tip || 'Get endorsed by colleagues and managers',
    },
  };
}
