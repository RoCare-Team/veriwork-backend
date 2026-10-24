import crypto from 'crypto';
import { AadhaarVerification } from '../models/AadhaarVerification.js';
import { AccessRequest } from '../models/AccessRequest.js';
import { ActivityLog } from '../models/ActivityLog.js';
import { Company } from '../models/Company.js';
import { CompanyAuditLog } from '../models/CompanyAuditLog.js';
import { CompanyEmployee } from '../models/CompanyEmployee.js';
import { CompanyEmployeeInvitation } from '../models/CompanyEmployeeInvitation.js';
import { CompanyOnboarding } from '../models/CompanyOnboarding.js';
import { CompanyRole } from '../models/CompanyRole.js';
import { CompanyUserInvite } from '../models/CompanyUserInvite.js';
import { DigiLockerConnection } from '../models/DigiLockerConnection.js';
import { DigiLockerOAuthState } from '../models/DigiLockerOAuthState.js';
import { Document } from '../models/Document.js';
import { EmployeeProfile } from '../models/EmployeeProfile.js';
import { Endorsement } from '../models/Endorsement.js';
import { JobExperience } from '../models/JobExperience.js';
import { JoinRequest } from '../models/JoinRequest.js';
import { OnboardingMessage } from '../models/OnboardingMessage.js';
import { OtpSession } from '../models/OtpSession.js';
import { PublicProfileAccessRequest } from '../models/PublicProfileAccessRequest.js';
import { QrOnboarding } from '../models/QrOnboarding.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { User } from '../models/User.js';
import { VaultItem } from '../models/VaultItem.js';
import { VerificationRequest } from '../models/VerificationRequest.js';
import { ApiError } from '../utils/ApiError.js';
import { deleteStoredFile } from '../utils/fileUpload.js';
import { normalizePhone } from '../utils/idGenerators.js';
import { sendBrandedEmail } from './emailService.js';
import { sendOtp, verifyOtp } from './otpService.js';

const EMAIL_OTP_TTL_MIN = 10;
const EMAIL_OTP_RESEND_MS = 60 * 1000;
const EMAIL_OTP_MAX_ATTEMPTS = 5;

/**
 * Every uploaded file belonging to an employee, so a purge takes the bytes out
 * of S3 (or off disk) and not just the rows pointing at them. Aadhaar card
 * scans and the liveness selfie matter most here — they are the most sensitive
 * thing the platform holds.
 */
function collectEmployeeFiles({ profile, documents, aadhaar }) {
  const files = [];

  if (profile?.photoUrl) files.push({ url: profile.photoUrl });
  for (const doc of documents) {
    if (doc.url) files.push({ url: doc.url });
  }
  if (aadhaar) {
    for (const image of [aadhaar.frontImage, aadhaar.backImage]) {
      if (image?.url || image?.key) files.push({ url: image.url || '', key: image.key || '' });
    }
    if (aadhaar.faceMatch?.selfieUrl) files.push({ url: aadhaar.faceMatch.selfieUrl });
  }

  return files;
}

/**
 * Permanently erase an employee and everything the platform holds about them.
 * Shared by the admin console purge and the employee's own "delete my account"
 * (the Play Store account-deletion requirement); callers do their own
 * confirmation check first, since this cannot be undone.
 *
 * Records other companies hold about this person go too (verification requests,
 * endorsements, roster entries), because a half-erased employee still leaves
 * their name and history sitting in someone else's dashboard.
 *
 * Deliberately NOT run in a transaction: that would need a replica set and
 * would break local single-node development. Instead the User row is deleted
 * last, so a failure part-way leaves the account still in place and the purge
 * simply re-runnable, rather than orphaning data behind a vanished user.
 *
 * `deletedBy` is only for the log line, e.g. "admin <id>" or "self".
 */
export async function purgeEmployee(user, profile, { deletedBy }) {
  const id = user._id;

  // Read the file-bearing records before their rows go, so we still know which
  // objects to remove from storage.
  const [documents, aadhaar] = await Promise.all([
    Document.find({ userId: id }).lean(),
    AadhaarVerification.findOne({ userId: id }).lean(),
  ]);
  const files = collectEmployeeFiles({ profile, documents, aadhaar });

  const [
    activityLogs,
    docs,
    vaultItems,
    jobExperiences,
    aadhaarRecords,
    verificationRequests,
    endorsements,
    companyEmployees,
    invitations,
    joinRequests,
    accessRequests,
    publicProfileRequests,
    digilockerConnections,
    refreshTokens,
    profiles,
  ] = await Promise.all([
    ActivityLog.deleteMany({ userId: id }),
    Document.deleteMany({ userId: id }),
    VaultItem.deleteMany({ userId: id }),
    JobExperience.deleteMany({ userId: id }),
    AadhaarVerification.deleteMany({ userId: id }),
    // Only requests *about* this employee. A row where they merely appear as
    // requester or responder belongs to someone else's history.
    VerificationRequest.deleteMany({ employeeId: id }),
    Endorsement.deleteMany({ $or: [{ employeeId: id }, { endorsedBy: id }] }),
    CompanyEmployee.deleteMany({ employeeId: id }),
    CompanyEmployeeInvitation.deleteMany({ employeeId: id }),
    JoinRequest.deleteMany({ candidateUserId: id }),
    AccessRequest.deleteMany({ $or: [{ employeeId: id }, { employeeUserId: id }] }),
    PublicProfileAccessRequest.deleteMany({ employeeUserId: id }),
    // Stored DigiLocker access/refresh tokens and identity — must not outlive the account.
    DigiLockerConnection.deleteMany({ userId: id }),
    RefreshToken.deleteMany({ userId: id }),
    EmployeeProfile.deleteMany({ userId: id }),
    DigiLockerOAuthState.deleteMany({ userId: id }),
  ]);

  // Colleagues who reported to this person keep their roster row — it just
  // loses a manager, rather than being deleted along with them.
  await CompanyEmployee.updateMany(
    { reportingManagerId: id },
    { $set: { reportingManagerId: null } },
  );

  // OTP sessions are keyed by phone number, not user id.
  if (user.phone) await OtpSession.deleteMany({ phone: user.phone });

  const filesDeleted = (
    await Promise.all(files.map((file) => deleteStoredFile(file.url, file.key)))
  ).filter(Boolean).length;

  await User.deleteOne({ _id: id });

  const counts = {
    activityLogs: activityLogs.deletedCount,
    documents: docs.deletedCount,
    vaultItems: vaultItems.deletedCount,
    jobExperiences: jobExperiences.deletedCount,
    aadhaarRecords: aadhaarRecords.deletedCount,
    verificationRequests: verificationRequests.deletedCount,
    endorsements: endorsements.deletedCount,
    companyRosterEntries: companyEmployees.deletedCount,
    invitations: invitations.deletedCount,
    joinRequests: joinRequests.deletedCount,
    accessRequests: accessRequests.deletedCount,
    publicProfileRequests: publicProfileRequests.deletedCount,
    digilockerConnections: digilockerConnections.deletedCount,
    refreshTokens: refreshTokens.deletedCount,
    profiles: profiles.deletedCount,
    files: filesDeleted,
  };

  // There is no platform-level audit collection, and the employee's own
  // ActivityLog rows are gone — so this line is the only lasting record that
  // the deletion happened. Keep it structured and greppable.
  console.log(
    `[account] PERMANENTLY DELETED employee ${id} (${profile?.veriworkId || 'no id'}) ` +
      `by ${deletedBy} :: ${JSON.stringify(counts)}`,
  );

  return {
    id,
    deleted: true,
    name: profile?.name || '',
    veriworkId: profile?.veriworkId || '',
    counts,
  };
}

/**
 * Employee deletes their own account from the app. The caller is already
 * authenticated as this employee, so the only guard needed is a deliberate
 * confirmation word — the app shows a "type DELETE to confirm" step.
 */
export async function deleteOwnEmployeeAccount(user, { confirm } = {}) {
  if (user.role !== 'employee') {
    throw ApiError.forbidden('Only employee accounts can be deleted here');
  }
  if (String(confirm || '').trim().toUpperCase() !== 'DELETE') {
    throw ApiError.badRequest('Type DELETE to confirm permanent account deletion');
  }

  const profile = await EmployeeProfile.findOne({ userId: user._id }).lean();
  const result = await purgeEmployee(user, profile, { deletedBy: 'self' });

  return { deleted: true, id: result.id };
}

// ---------------------------------------------------------------------------
// Account deletion without a session — for the Play Store "delete account"
// flow, where the person may not be logged in. Ownership is proved by an OTP:
// SMS to the employee's mobile number, email to the employer's work email.
// ---------------------------------------------------------------------------

async function findEmployeeByPhone(phone) {
  const normalized = normalizePhone(String(phone || ''));
  const user = await User.findOne({ phone: normalized, role: 'employee' });
  if (!user) throw ApiError.notFound('No employee account is registered with this mobile number');
  return user;
}

export async function sendEmployeeDeletionOtp(phone) {
  await findEmployeeByPhone(phone);
  return sendOtp(phone);
}

export async function confirmEmployeeDeletion(phone, code) {
  const user = await findEmployeeByPhone(phone);
  await verifyOtp(phone, code);

  const profile = await EmployeeProfile.findOne({ userId: user._id }).lean();
  const result = await purgeEmployee(user, profile, { deletedBy: 'self (mobile OTP)' });
  return { deleted: true, id: result.id };
}

function hashOtp(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

async function findEnterpriseUserByEmail(email) {
  const normalized = String(email || '').toLowerCase().trim();
  const user = await User.findOne({ email: normalized, role: 'enterprise_admin' });
  if (!user) throw ApiError.notFound('No employer account is registered with this work email');
  return user;
}

export async function sendEmployerDeletionOtp(email) {
  const user = await findEnterpriseUserByEmail(email);

  if (user.deletionOtpSentAt && Date.now() - user.deletionOtpSentAt.getTime() < EMAIL_OTP_RESEND_MS) {
    throw ApiError.tooManyRequests('Please wait a minute before requesting another OTP');
  }

  const code = String(crypto.randomInt(100000, 1000000));
  user.deletionOtpHash = hashOtp(code);
  user.deletionOtpExpires = new Date(Date.now() + EMAIL_OTP_TTL_MIN * 60 * 1000);
  user.deletionOtpSentAt = new Date();
  user.deletionOtpAttempts = 0;
  await user.save();

  const delivery = await sendBrandedEmail({
    to: user.email,
    subject: 'Your PagerLook account deletion code',
    heading: 'Confirm account deletion',
    bodyHtml: `
      <p>We received a request to permanently delete your PagerLook employer account.</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:24px 0;">${code}</p>
      <p>Enter this code to confirm. If you didn't request this, ignore this email — nothing will be deleted.</p>
    `,
    text: `Your PagerLook account deletion code is ${code}. It expires in ${EMAIL_OTP_TTL_MIN} minutes.`,
    footerNote: `This code expires in ${EMAIL_OTP_TTL_MIN} minutes.`,
    category: 'Account deletion',
  });

  if (delivery.mock) {
    console.log(`[account] dev mock deletion OTP for ${user.email}: ${code}`);
  } else if (!delivery.sent) {
    throw ApiError.serviceUnavailable('Could not send the email right now. Please try again.');
  }

  return {
    email: user.email,
    otpLength: code.length,
    expiresInMinutes: EMAIL_OTP_TTL_MIN,
    message: 'Account deletion OTP sent to your work email',
  };
}

/**
 * Remove a company and everything scoped to it: roster, invitations, roles,
 * onboarding application (and its uploaded documents), the verification
 * requests it raised, and every enterprise user on it. Employees themselves
 * are untouched — they only lose this company from their side.
 */
async function purgeCompany(company, { deletedBy }) {
  const companyId = company._id;
  const companyUsers = await User.find({ companyId, role: 'enterprise_admin' }).select('_id').lean();
  const userIds = companyUsers.map((u) => u._id);

  const onboarding = await CompanyOnboarding.findOne({ companyId }).lean();
  const files = onboarding?.documents ? Object.values(onboarding.documents).filter(Boolean) : [];

  const results = await Promise.all([
    CompanyEmployee.deleteMany({ companyId }),
    CompanyEmployeeInvitation.deleteMany({ companyId }),
    AccessRequest.deleteMany({ companyId }),
    JoinRequest.deleteMany({ companyId }),
    OnboardingMessage.deleteMany({ companyId }),
    QrOnboarding.deleteMany({ companyId }),
    CompanyUserInvite.deleteMany({ companyId }),
    CompanyRole.deleteMany({ companyId }),
    CompanyAuditLog.deleteMany({ companyId }),
    CompanyOnboarding.deleteMany({ companyId }),
    VerificationRequest.deleteMany({ requestingCompanyId: companyId }),
    RefreshToken.deleteMany({ userId: { $in: userIds } }),
  ]);

  const filesDeleted = (await Promise.all(files.map((url) => deleteStoredFile(url)))).filter(
    Boolean,
  ).length;

  // Users and the company row last, so a failure part-way stays re-runnable.
  const users = await User.deleteMany({ _id: { $in: userIds } });
  await Company.deleteOne({ _id: companyId });

  console.log(
    `[account] PERMANENTLY DELETED company ${companyId} (${company.name}) by ${deletedBy} :: ` +
      JSON.stringify({
        rows: results.reduce((sum, r) => sum + r.deletedCount, 0),
        users: users.deletedCount,
        files: filesDeleted,
      }),
  );
}

/**
 * Verify the emailed code, then delete. The company owner (or the account
 * whose email is the company's registered work email) takes the whole company
 * with them; any other team member only removes their own login.
 */
export async function confirmEmployerDeletion(email, code) {
  const user = await findEnterpriseUserByEmail(email);

  if (!user.deletionOtpHash || !user.deletionOtpExpires) {
    throw ApiError.badRequest('No deletion OTP found. Request a new OTP.');
  }
  if (user.deletionOtpAttempts >= EMAIL_OTP_MAX_ATTEMPTS) {
    throw ApiError.tooManyRequests('Too many incorrect attempts. Request a new OTP.');
  }
  if (user.deletionOtpExpires < new Date()) {
    throw ApiError.badRequest('OTP expired. Request a new OTP.');
  }
  if (hashOtp(String(code || '').trim()) !== user.deletionOtpHash) {
    user.deletionOtpAttempts += 1;
    await user.save();
    throw ApiError.badRequest('Invalid OTP code.');
  }

  const company = user.companyId ? await Company.findById(user.companyId) : null;
  const isOwner =
    user.companyRole === 'owner' ||
    (company && company.workEmail?.toLowerCase().trim() === user.email);

  if (company && isOwner) {
    await purgeCompany(company, { deletedBy: `owner ${user._id} (email OTP)` });
    return { deleted: true, id: user._id, companyDeleted: true };
  }

  await RefreshToken.deleteMany({ userId: user._id });
  await User.deleteOne({ _id: user._id });
  console.log(`[account] PERMANENTLY DELETED enterprise user ${user._id} by self (email OTP)`);
  return { deleted: true, id: user._id, companyDeleted: false };
}
