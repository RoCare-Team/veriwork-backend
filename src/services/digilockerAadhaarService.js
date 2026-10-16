import crypto from 'crypto';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { storeUploadedFile } from '../utils/fileUpload.js';
import { AadhaarVerification } from '../models/AadhaarVerification.js';
import { EmployeeProfile } from '../models/EmployeeProfile.js';
import { refreshCachedScore } from './employeeProfileService.js';

/*
 * Aadhaar KYC through DigiLocker. After the employee consents on DigiLocker we
 * pull the UIDAI e-Aadhaar XML with their access token, then match its name,
 * date of birth and gender against what they entered on their profile. A full
 * match verifies Aadhaar on the spot; any mismatch is recorded field by field
 * so the employee knows exactly what to correct. No admin review is involved.
 *
 * The XML is fetched server-to-server from DigiLocker over TLS with the user's
 * own token, so we trust the transport rather than re-validating the UIDAI
 * XML signature here.
 */

const NAME_MATCH_THRESHOLD = 0.85;
const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'shri', 'sri', 'smt', 'kumari', 'km', 'late']);

// ── XML helpers (the e-Aadhaar layout is fixed: UidData > Poi/Poa/Pht) ──────

function decodeEntities(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

function attributesOf(xml, tag) {
  const match = xml.match(new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*?)\\/?>`));
  if (!match) return null;
  const attrs = {};
  for (const [, key, value] of match[1].matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) {
    attrs[key] = decodeEntities(value).trim();
  }
  return attrs;
}

function textOf(xml, tag) {
  const match = xml.match(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`));
  return match ? match[1].trim() : '';
}

export function parseEAadhaarXml(xml) {
  const poi = attributesOf(xml, 'Poi');
  if (!poi) return null;
  const uidData = attributesOf(xml, 'UidData') || {};
  const poa = attributesOf(xml, 'Poa') || {};
  const address = ['co', 'house', 'street', 'lm', 'loc', 'vtc', 'po', 'subdist', 'dist', 'state', 'pc', 'country']
    .map((key) => poa[key])
    .filter(Boolean)
    .join(', ');

  return {
    maskedUid: uidData.uid || '',
    name: poi.name || '',
    dob: poi.dob || '',
    gender: poi.gender || '',
    address,
    photoBase64: textOf(xml, 'Pht').replace(/\s+/g, ''),
  };
}

// ── Normalisers / matchers ──────────────────────────────────────────────────

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token && !HONORIFICS.has(token));
}

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const temp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return row[b.length];
}

export function namesMatch(profileName, aadhaarName) {
  const a = normalizeName(profileName);
  const b = normalizeName(aadhaarName);
  if (!a.length || !b.length) return false;

  const sortedA = [...a].sort().join(' ');
  const sortedB = [...b].sort().join(' ');
  if (sortedA === sortedB) return true;

  // A dropped middle name ("Rahul Sharma" vs "Rahul Kumar Sharma") still matches,
  // as long as at least first + last name are present.
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length >= 2 && shorter.every((token) => longer.includes(token))) return true;

  // Small spelling variations (Mohd/Mohammad aside) — similarity on the sorted tokens.
  const distance = levenshtein(sortedA, sortedB);
  return 1 - distance / Math.max(sortedA.length, sortedB.length) >= NAME_MATCH_THRESHOLD;
}

/** e-Aadhaar DOB is DD-MM-YYYY (or DD/MM/YYYY, or just YYYY); profile is YYYY-MM-DD. */
export function normalizeAadhaarDob(value) {
  const raw = String(value || '').trim();
  let m = raw.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return raw;
  m = raw.match(/^(\d{4})$/);
  if (m) return raw;
  return '';
}

function dobMatches(profileDob, aadhaarDob) {
  if (!profileDob || !aadhaarDob) return false;
  // Some older Aadhaar records carry only the birth year.
  if (/^\d{4}$/.test(aadhaarDob)) return profileDob.slice(0, 4) === aadhaarDob;
  return profileDob === aadhaarDob;
}

function normalizeAadhaarGender(value) {
  return { M: 'male', F: 'female', T: 'other' }[String(value || '').trim().toUpperCase()] || '';
}

function buildChecks(profile, aadhaar) {
  const checks = [
    {
      field: 'name',
      expected: profile.name || '',
      actual: aadhaar.name,
      matched: namesMatch(profile.name, aadhaar.name),
    },
    {
      field: 'dob',
      expected: profile.dateOfBirth || '',
      actual: aadhaar.dob,
      matched: dobMatches(profile.dateOfBirth, aadhaar.dob),
    },
  ];
  // Gender is only compared when the employee actually stated one.
  if (['male', 'female', 'other'].includes(profile.gender) && aadhaar.gender) {
    checks.push({
      field: 'gender',
      expected: profile.gender,
      actual: aadhaar.gender,
      matched: profile.gender === aadhaar.gender,
    });
  }
  return checks;
}

const FIELD_LABELS = { name: 'Name', dob: 'Date of birth', gender: 'Gender' };

function mismatchReason(checks) {
  const failed = checks.filter((c) => !c.matched).map((c) => FIELD_LABELS[c.field] || c.field);
  return failed.length
    ? `${failed.join(', ')} on your profile ${failed.length > 1 ? 'do' : 'does'} not match your Aadhaar. Update your profile to match Aadhaar exactly and verify again.`
    : '';
}

function identityHash(aadhaar) {
  const key = [aadhaar.maskedUid.slice(-4), aadhaar.dob, normalizeName(aadhaar.name).sort().join(' ')].join('|');
  return crypto.createHash('sha256').update(`aadhaar-dl:${key}`).digest('hex');
}

async function fetchEAadhaar(accessToken) {
  const response = await fetch(env.digilocker.eaadhaarUrl, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/xml' },
  });
  const body = await response.text().catch(() => '');
  if (!response.ok) {
    console.error('[digilocker] e-Aadhaar fetch failed', response.status, body.slice(0, 200));
    throw ApiError.badRequest(
      response.status === 404
        ? 'No Aadhaar is linked to this DigiLocker account. Link Aadhaar in DigiLocker and try again.'
        : 'Could not fetch your Aadhaar from DigiLocker. Please try again.',
    );
  }
  const parsed = parseEAadhaarXml(body);
  if (!parsed?.name) throw ApiError.badRequest('DigiLocker returned an unreadable Aadhaar record');
  return parsed;
}

async function storeAadhaarPhoto(photoBase64) {
  if (!photoBase64) return null;
  const buffer = Buffer.from(photoBase64, 'base64');
  if (buffer.length < 512) return null;
  const stored = await storeUploadedFile(
    { buffer, originalname: 'aadhaar-photo.jpg', mimetype: 'image/jpeg', size: buffer.length },
    'aadhaar',
  );
  return stored
    ? {
        url: stored.url,
        key: stored.key || '',
        originalName: 'aadhaar-photo.jpg',
        mimeType: 'image/jpeg',
        size: buffer.length,
        uploadedAt: new Date(),
      }
    : null;
}

/**
 * Pulls e-Aadhaar for a freshly connected DigiLocker account and verifies it
 * against the employee's profile. Returns { verified, message }.
 */
export async function verifyAadhaarViaDigiLocker(userId, { accessToken, digilockerId }) {
  const profile = await EmployeeProfile.findOne({ userId });
  if (!profile) throw ApiError.notFound('Employee profile not found');
  if (!profile.profileSetupComplete) {
    throw ApiError.badRequest('Complete profile setup before Aadhaar verification');
  }

  const existing = await AadhaarVerification.findOne({ userId });
  if (existing?.status === 'approved' && profile.aadhaarVerified) {
    return { verified: true, message: 'Aadhaar is already verified' };
  }

  const raw = await fetchEAadhaar(accessToken);
  const aadhaar = {
    ...raw,
    dob: normalizeAadhaarDob(raw.dob),
    gender: normalizeAadhaarGender(raw.gender),
  };

  const hash = identityHash(aadhaar);
  const duplicate = await AadhaarVerification.findOne({
    userId: { $ne: userId },
    status: 'approved',
    $or: [{ aadhaarNumberHash: hash }, ...(digilockerId ? [{ 'digilocker.digilockerId': digilockerId }] : [])],
  });
  if (duplicate) throw ApiError.badRequest('This Aadhaar is already verified on another PagerLook account');

  const checks = buildChecks(profile, aadhaar);
  const verified = checks.every((c) => c.matched);
  const photo = await storeAadhaarPhoto(aadhaar.photoBase64);
  const now = new Date();

  const fields = {
    method: 'digilocker',
    aadhaarNumberEnc: '',
    aadhaarNumberHash: hash,
    aadhaarLast4: aadhaar.maskedUid.replace(/\D/g, '').slice(-4),
    nameOnAadhaar: aadhaar.name,
    dobOnAadhaar: aadhaar.dob,
    genderOnAadhaar: aadhaar.gender,
    addressOnAadhaar: aadhaar.address,
    frontImage: photo,
    backImage: null,
    consentAccepted: true,
    status: verified ? 'approved' : 'rejected',
    submittedAt: now,
    reviewedAt: now,
    reviewedBy: null,
    reviewNotes: 'Auto-verified against UIDAI e-Aadhaar via DigiLocker',
    rejectionReason: mismatchReason(checks),
    digilocker: { digilockerId: digilockerId || '', fetchedAt: now, checks },
    // New reference photo — any earlier face match no longer applies.
    faceMatch: {},
  };

  if (existing) {
    Object.assign(existing, fields);
    existing.submissionCount += 1;
    await existing.save();
  } else {
    await AadhaarVerification.create({ userId, ...fields, submissionCount: 1 });
  }

  profile.aadhaarVerified = verified;
  profile.biometricVerified = false;
  if (verified) profile.digilockerUsed = true;
  await profile.save();
  await refreshCachedScore(userId);

  return {
    verified,
    message: verified ? 'Aadhaar verified via DigiLocker' : mismatchReason(checks),
  };
}
