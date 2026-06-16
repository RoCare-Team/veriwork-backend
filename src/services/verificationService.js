import { EmployeeProfile } from '../models/EmployeeProfile.js';
import { ApiError } from '../utils/ApiError.js';
import {
  getCurrentVerificationStep,
  getVerificationPercent,
  isVerificationComplete,
} from './scoreService.js';
import { refreshCachedScore } from './employeeProfileService.js';

export async function getVerificationStatus(userId) {
  const profile = await EmployeeProfile.findOne({ userId });
  if (!profile) throw ApiError.notFound('Employee profile not found');

  return {
    profileSetupComplete: profile.profileSetupComplete,
    aadhaarVerified: profile.aadhaarVerified,
    biometricVerified: profile.biometricVerified,
    digilockerUsed: profile.digilockerUsed,
    verificationPercent: getVerificationPercent(profile),
    isComplete: isVerificationComplete(profile),
    currentStep: getCurrentVerificationStep(profile),
    steps: [
      {
        id: 'profile',
        label: 'Profile',
        title: 'Create your profile',
        description: 'Name, role, contact details',
        complete: profile.profileSetupComplete,
      },
      {
        id: 'aadhaar',
        label: 'Aadhaar',
        title: 'Link Aadhaar',
        description: 'Secure e-KYC via DigiLocker or Aadhaar OTP',
        complete: profile.aadhaarVerified,
      },
      {
        id: 'biometric',
        label: 'Biometric',
        title: 'Biometric check',
        description: 'Live face match with ID photo via selfie',
        complete: profile.biometricVerified,
      },
    ],
  };
}

export async function verifyAadhaar(userId, { method }) {
  const profile = await EmployeeProfile.findOne({ userId });
  if (!profile) throw ApiError.notFound('Employee profile not found');

  if (!profile.profileSetupComplete) {
    throw ApiError.badRequest('Complete profile setup before Aadhaar verification');
  }
  if (profile.aadhaarVerified) {
    return { message: 'Aadhaar already verified', profile: profile.toObject() };
  }

  profile.aadhaarVerified = true;
  if (method === 'digilocker') {
    profile.digilockerUsed = true;
  }
  await profile.save();
  await refreshCachedScore(userId);

  return {
    message: method === 'digilocker'
      ? 'Aadhaar verified via DigiLocker (mock)'
      : 'Aadhaar verified via OTP (mock)',
    aadhaarVerified: true,
    digilockerUsed: profile.digilockerUsed,
  };
}

export async function verifyBiometric(userId, photoUrl) {
  const profile = await EmployeeProfile.findOne({ userId });
  if (!profile) throw ApiError.notFound('Employee profile not found');

  if (!profile.aadhaarVerified) {
    throw ApiError.badRequest('Complete Aadhaar verification before biometric check');
  }
  if (profile.biometricVerified) {
    return { message: 'Biometric already verified', profile: profile.toObject() };
  }

  profile.biometricVerified = true;
  if (photoUrl) profile.photoUrl = photoUrl;
  await profile.save();
  await refreshCachedScore(userId);

  return {
    message: 'Biometric liveness check passed (mock)',
    biometricVerified: true,
    photoUrl: profile.photoUrl,
  };
}
