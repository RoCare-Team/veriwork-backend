import { AadhaarVerification } from '../models/AadhaarVerification.js';
import { EmployeeProfile } from '../models/EmployeeProfile.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { encryptSecret, decryptSecret } from '../utils/crypto.js';
import { storeUploadedFile } from '../utils/fileUpload.js';
import {
  formatAadhaarNumber,
  hashAadhaarNumber,
  isValidAadhaarNumber,
  normalizeAadhaarNumber,
} from '../utils/aadhaar.js';
import { refreshCachedScore } from './employeeProfileService.js';

function toStoredImage(stored) {
  if (!stored) return null;
  return {
    url: stored.url,
    key: stored.key || '',
    originalName: stored.originalName || '',
    mimeType: stored.mimeType || '',
    size: stored.size || 0,
    uploadedAt: new Date(),
  };
}

/** Employee-facing shape — never exposes the full Aadhaar number. */
export function formatSubmissionForEmployee(record) {
  if (!record) {
    return {
      submitted: false,
      status: 'not_submitted',
      canSubmit: true,
    };
  }

  return {
    submitted: true,
    status: record.status,
    canSubmit: record.status === 'rejected',
    aadhaarMasked: `XXXX XXXX ${record.aadhaarLast4}`,
    aadhaarLast4: record.aadhaarLast4,
    nameOnAadhaar: record.nameOnAadhaar,
    dobOnAadhaar: record.dobOnAadhaar,
    frontImageUrl: record.frontImage?.url || '',
    backImageUrl: record.backImage?.url || '',
    submittedAt: record.submittedAt,
    submissionCount: record.submissionCount,
    reviewedAt: record.reviewedAt,
    rejectionReason: record.rejectionReason || '',
    faceMatch: {
      matched: record.faceMatch?.matched || false,
      similarity: record.faceMatch?.similarity || 0,
      threshold: record.faceMatch?.threshold || 0,
      attempts: record.faceMatch?.attempts || 0,
      livenessPassed: record.faceMatch?.livenessPassed || false,
      verifiedAt: record.faceMatch?.verifiedAt || null,
    },
  };
}

/** Admin-facing shape — the reviewer needs the full number to check the card. */
function formatSubmissionForAdmin(record, { profile, user, reviewer } = {}) {
  const digits = decryptSecret(record.aadhaarNumberEnc);

  return {
    id: record._id,
    userId: record.userId,
    status: record.status,
    aadhaarNumber: formatAadhaarNumber(digits),
    aadhaarMasked: `XXXX XXXX ${record.aadhaarLast4}`,
    aadhaarLast4: record.aadhaarLast4,
    nameOnAadhaar: record.nameOnAadhaar,
    dobOnAadhaar: record.dobOnAadhaar,
    genderOnAadhaar: record.genderOnAadhaar,
    addressOnAadhaar: record.addressOnAadhaar,
    frontImageUrl: record.frontImage?.url || '',
    backImageUrl: record.backImage?.url || '',
    consentAccepted: record.consentAccepted,
    submittedAt: record.submittedAt,
    submissionCount: record.submissionCount,
    reviewedAt: record.reviewedAt,
    reviewedBy: reviewer ? { id: reviewer._id, email: reviewer.email } : null,
    reviewNotes: record.reviewNotes || '',
    rejectionReason: record.rejectionReason || '',
    faceMatch: {
      provider: record.faceMatch?.provider || '',
      matched: record.faceMatch?.matched || false,
      similarity: record.faceMatch?.similarity || 0,
      threshold: record.faceMatch?.threshold || 0,
      livenessPassed: record.faceMatch?.livenessPassed || false,
      selfieUrl: record.faceMatch?.selfieUrl || '',
      attempts: record.faceMatch?.attempts || 0,
      verifiedAt: record.faceMatch?.verifiedAt || null,
    },
    employee: profile
      ? {
          id: profile.userId,
          name: profile.name || 'New User',
          email: profile.email || user?.email || '',
          phone: profile.phone || user?.phone || '',
          veriworkId: profile.veriworkId,
          photoUrl: profile.photoUrl || '',
          dateOfBirth: profile.dateOfBirth || '',
          // Surfaced so the reviewer can spot a name that does not match the card.
          profileNameMatches:
            Boolean(profile.name) &&
            profile.name.trim().toLowerCase() === (record.nameOnAadhaar || '').trim().toLowerCase(),
          profileDobMatches:
            Boolean(profile.dateOfBirth) && profile.dateOfBirth === record.dobOnAadhaar,
          aadhaarVerified: profile.aadhaarVerified,
          biometricVerified: profile.biometricVerified,
        }
      : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function getSubmission(userId) {
  const record = await AadhaarVerification.findOne({ userId });
  return formatSubmissionForEmployee(record);
}

export async function submitManualAadhaar(userId, payload, files) {
  const profile = await EmployeeProfile.findOne({ userId });
  if (!profile) throw ApiError.notFound('Employee profile not found');
  if (!profile.profileSetupComplete) {
    throw ApiError.badRequest('Complete profile setup before Aadhaar verification');
  }

  const digits = normalizeAadhaarNumber(payload.aadhaarNumber);
  if (!isValidAadhaarNumber(digits)) {
    throw ApiError.badRequest('Enter a valid 12-digit Aadhaar number');
  }
  if (!payload.consent) {
    throw ApiError.badRequest('Consent is required to submit Aadhaar for verification');
  }

  const existing = await AadhaarVerification.findOne({ userId });
  if (existing && existing.status === 'approved') {
    throw ApiError.badRequest('Aadhaar is already verified');
  }
  if (existing && existing.status === 'pending') {
    throw ApiError.badRequest('Your Aadhaar submission is already under review');
  }

  const frontFile = files?.frontImage?.[0];
  const backFile = files?.backImage?.[0];
  if (!frontFile) throw ApiError.badRequest('Front image of the Aadhaar card is required');
  if (!backFile) throw ApiError.badRequest('Back image of the Aadhaar card is required');

  const hash = hashAadhaarNumber(digits);
  const duplicate = await AadhaarVerification.findOne({
    aadhaarNumberHash: hash,
    userId: { $ne: userId },
  });
  if (duplicate) {
    throw ApiError.badRequest('This Aadhaar number is already linked to another account');
  }

  const [frontStored, backStored] = await Promise.all([
    storeUploadedFile(frontFile, 'aadhaar'),
    storeUploadedFile(backFile, 'aadhaar'),
  ]);

  const fields = {
    aadhaarNumberEnc: encryptSecret(digits),
    aadhaarNumberHash: hash,
    aadhaarLast4: digits.slice(-4),
    nameOnAadhaar: payload.nameOnAadhaar?.trim() || profile.name || '',
    dobOnAadhaar: payload.dobOnAadhaar?.trim() || profile.dateOfBirth || '',
    genderOnAadhaar: payload.genderOnAadhaar || '',
    addressOnAadhaar: payload.addressOnAadhaar?.trim() || '',
    frontImage: toStoredImage(frontStored),
    backImage: toStoredImage(backStored),
    consentAccepted: true,
    status: 'pending',
    submittedAt: new Date(),
    reviewedAt: null,
    reviewedBy: null,
    reviewNotes: '',
    rejectionReason: '',
  };

  let record;
  if (existing) {
    // Resubmission after a rejection — reset the review state and the face
    // match, since the reference photo on the card has changed.
    Object.assign(existing, fields);
    existing.submissionCount += 1;
    existing.faceMatch = {
      provider: '',
      similarity: 0,
      threshold: 0,
      matched: false,
      livenessPassed: false,
      selfieUrl: '',
      attempts: 0,
      lastAttemptAt: null,
      lastError: '',
      verifiedAt: null,
    };
    record = await existing.save();
  } else {
    record = await AadhaarVerification.create({ userId, ...fields, submissionCount: 1 });
  }

  return {
    message: 'Aadhaar submitted for admin verification',
    submission: formatSubmissionForEmployee(record),
  };
}

export async function listAadhaarRequests({ status = 'pending', q } = {}) {
  const filter = {};
  if (status && status !== 'all') filter.status = status;

  const records = await AadhaarVerification.find(filter)
    .sort({ submittedAt: -1 })
    .limit(200);

  const userIds = records.map((r) => r.userId);
  const [profiles, users] = await Promise.all([
    EmployeeProfile.find({ userId: { $in: userIds } }).lean(),
    User.find({ _id: { $in: userIds } }).lean(),
  ]);

  const profileMap = new Map(profiles.map((p) => [p.userId.toString(), p]));
  const userMap = new Map(users.map((u) => [u._id.toString(), u]));

  const items = records.map((record) => {
    const key = record.userId.toString();
    return formatSubmissionForAdmin(record, {
      profile: profileMap.get(key),
      user: userMap.get(key),
    });
  });

  const needle = q?.trim().toLowerCase();
  if (!needle) return items;

  return items.filter((item) => {
    const haystack = [
      item.employee?.name,
      item.employee?.email,
      item.employee?.phone,
      item.employee?.veriworkId,
      item.nameOnAadhaar,
      item.aadhaarLast4,
      item.aadhaarNumber,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export async function getAadhaarRequest(id) {
  const record = await AadhaarVerification.findById(id);
  if (!record) throw ApiError.notFound('Aadhaar verification request not found');

  const [profile, user, reviewer] = await Promise.all([
    EmployeeProfile.findOne({ userId: record.userId }).lean(),
    User.findById(record.userId).lean(),
    record.reviewedBy ? User.findById(record.reviewedBy).lean() : null,
  ]);

  return formatSubmissionForAdmin(record, { profile, user, reviewer });
}

export async function reviewAadhaarRequest(adminUserId, id, { status, reason, notes }) {
  const record = await AadhaarVerification.findById(id);
  if (!record) throw ApiError.notFound('Aadhaar verification request not found');

  if (record.status !== 'pending') {
    throw ApiError.badRequest('This submission has already been reviewed');
  }

  const profile = await EmployeeProfile.findOne({ userId: record.userId });
  if (!profile) throw ApiError.notFound('Employee profile not found');

  record.status = status;
  record.reviewedAt = new Date();
  record.reviewedBy = adminUserId;
  record.reviewNotes = notes?.trim() || '';

  if (status === 'approved') {
    record.rejectionReason = '';
    profile.aadhaarVerified = true;
  } else {
    record.rejectionReason = reason?.trim() || 'Aadhaar verification rejected by admin';
    profile.aadhaarVerified = false;
    // The face match is anchored to the card photo, so a rejected card
    // invalidates any biometric pass that was built on it.
    profile.biometricVerified = false;
    record.faceMatch.matched = false;
    record.faceMatch.verifiedAt = null;
  }

  await Promise.all([record.save(), profile.save()]);
  await refreshCachedScore(record.userId);

  const [user, reviewer] = await Promise.all([
    User.findById(record.userId).lean(),
    User.findById(adminUserId).lean(),
  ]);

  return {
    message: status === 'approved' ? 'Aadhaar approved' : 'Aadhaar submission rejected',
    request: formatSubmissionForAdmin(record, { profile: profile.toObject(), user, reviewer }),
  };
}

export async function countPendingAadhaarRequests() {
  return AadhaarVerification.countDocuments({ status: 'pending' });
}
