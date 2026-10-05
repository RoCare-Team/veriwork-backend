import { AadhaarVerification } from '../models/AadhaarVerification.js';
import { EmployeeProfile } from '../models/EmployeeProfile.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { storeUploadedFile } from '../utils/fileUpload.js';
import {
  getCurrentVerificationStep,
  getVerificationPercent,
  isVerificationComplete,
} from './scoreService.js';
import { refreshCachedScore } from './employeeProfileService.js';
import { formatSubmissionForEmployee } from './aadhaarVerificationService.js';
import { REFERENCE_IMAGE_ERROR, runFaceVerification } from './faceMatchService.js';

const AADHAAR_STEP_DESCRIPTIONS = {
  not_submitted: 'Upload your Aadhaar front and back for verification',
  pending: 'Submitted — waiting for admin approval',
  approved: 'Verified by the PagerLook team',
  rejected: 'Rejected — fix the issue and submit again',
};

export async function getVerificationStatus(userId) {
  const [profile, aadhaarRecord] = await Promise.all([
    EmployeeProfile.findOne({ userId }),
    AadhaarVerification.findOne({ userId }),
  ]);
  if (!profile) throw ApiError.notFound('Employee profile not found');

  const aadhaar = formatSubmissionForEmployee(aadhaarRecord);

  return {
    profileSetupComplete: profile.profileSetupComplete,
    aadhaarVerified: profile.aadhaarVerified,
    biometricVerified: profile.biometricVerified,
    digilockerUsed: profile.digilockerUsed,
    aadhaar,
    faceMatchEnabled: env.faceMatch.enabled,
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
        title: 'Aadhaar verification',
        description: AADHAAR_STEP_DESCRIPTIONS[aadhaar.status] || AADHAAR_STEP_DESCRIPTIONS.not_submitted,
        status: aadhaar.status,
        complete: profile.aadhaarVerified,
      },
      {
        id: 'biometric',
        label: 'Biometric',
        title: 'Face match',
        description: 'Live selfie matched against the photo on your Aadhaar card',
        complete: profile.biometricVerified,
      },
    ],
  };
}

/**
 * The biometric step compares a live selfie against the photo printed on the
 * Aadhaar card an admin already approved — so the reference image is one a
 * human has verified, not one the user simply uploaded.
 */
export async function verifyBiometric(userId, { selfieFile, poseFiles = [] }) {
  const profile = await EmployeeProfile.findOne({ userId });
  if (!profile) throw ApiError.notFound('Employee profile not found');

  const record = await AadhaarVerification.findOne({ userId });
  if (!record || record.status !== 'approved' || !profile.aadhaarVerified) {
    throw ApiError.badRequest('Your Aadhaar must be approved before the face match');
  }
  if (profile.biometricVerified) {
    return {
      message: 'Face match already completed',
      biometricVerified: true,
      similarity: record.faceMatch?.similarity || 0,
      threshold: record.faceMatch?.threshold || env.faceMatch.minSimilarity,
      photoUrl: profile.photoUrl,
    };
  }
  if (!selfieFile?.buffer) {
    throw ApiError.badRequest('A live selfie is required for the face match');
  }
  if ((record.faceMatch?.attempts || 0) >= env.faceMatch.maxAttempts) {
    throw ApiError.badRequest(
      'Too many failed face match attempts. Contact support to reset your verification.',
    );
  }

  record.faceMatch.attempts = (record.faceMatch.attempts || 0) + 1;
  record.faceMatch.lastAttemptAt = new Date();

  let result;
  try {
    result = await runFaceVerification({
      selfieBuffer: selfieFile.buffer,
      poseBuffers: poseFiles.map((f) => f?.buffer).filter(Boolean),
      referenceImage: record.frontImage,
    });
  } catch (err) {
    // A broken reference image is not the user's failed attempt — give it back.
    if (err?.code === REFERENCE_IMAGE_ERROR) {
      record.faceMatch.attempts = Math.max(0, record.faceMatch.attempts - 1);
    }
    record.faceMatch.lastError = err?.message || 'Face match failed';
    await record.save();
    throw err;
  }

  record.faceMatch.provider = result.provider;
  record.faceMatch.similarity = result.similarity;
  record.faceMatch.threshold = result.threshold;
  record.faceMatch.livenessPassed = result.liveness.passed;
  record.faceMatch.matched = result.matched;

  if (!result.matched) {
    record.faceMatch.lastError = `Similarity ${result.similarity}% is below the required ${result.threshold}%`;
    await record.save();
    throw ApiError.badRequest(
      `Face did not match the photo on your Aadhaar card (${result.similarity}% similar, ${result.threshold}% required). Retake the selfie in good lighting.`,
    );
  }

  if (!result.liveness.passed) {
    record.faceMatch.lastError = `Liveness check failed (${result.liveness.reason})`;
    await record.save();
    throw ApiError.badRequest(
      'Liveness check failed — follow the on-screen prompts and turn your head left and right during the scan.',
    );
  }

  const stored = await storeUploadedFile(selfieFile, 'biometric');
  record.faceMatch.selfieUrl = stored?.url || '';
  record.faceMatch.lastError = '';
  record.faceMatch.verifiedAt = new Date();

  profile.biometricVerified = true;
  if (stored?.url && !profile.photoUrl) {
    profile.photoUrl = stored.url;
  }

  await Promise.all([record.save(), profile.save()]);
  await refreshCachedScore(userId);

  return {
    message: `Face matched your Aadhaar photo at ${result.similarity}% similarity`,
    biometricVerified: true,
    provider: result.provider,
    similarity: result.similarity,
    threshold: result.threshold,
    livenessPassed: result.liveness.passed,
    photoUrl: profile.photoUrl,
  };
}
