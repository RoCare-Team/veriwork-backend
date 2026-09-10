import { AadhaarVerification } from '../models/AadhaarVerification.js';
import { countNewDemoRequests } from './demoRequestService.js';
import { AccessRequest } from '../models/AccessRequest.js';
import { ActivityLog } from '../models/ActivityLog.js';
import { Company } from '../models/Company.js';
import { CompanyEmployee } from '../models/CompanyEmployee.js';
import { CompanyEmployeeInvitation } from '../models/CompanyEmployeeInvitation.js';
import { CompanyOnboarding } from '../models/CompanyOnboarding.js';
import { Document } from '../models/Document.js';
import { EmployeeProfile } from '../models/EmployeeProfile.js';
import { Endorsement } from '../models/Endorsement.js';
import { JobExperience } from '../models/JobExperience.js';
import { JoinRequest } from '../models/JoinRequest.js';
import { OtpSession } from '../models/OtpSession.js';
import { PublicProfileAccessRequest } from '../models/PublicProfileAccessRequest.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { User } from '../models/User.js';
import { VaultItem } from '../models/VaultItem.js';
import { VerificationRequest } from '../models/VerificationRequest.js';
import { ApiError } from '../utils/ApiError.js';
import { deleteStoredFile } from '../utils/fileUpload.js';
import { getInitials } from '../utils/idGenerators.js';
import { assertValidObjectId } from '../utils/objectId.js';
import { mapDocumentReviews } from './onboardingReviewService.js';

function formatCompanyApplication(company, onboarding, adminUser) {
  return {
    id: company._id,
    company: {
      id: company._id,
      name: company.name,
      industry: company.industry,
      companySize: company.companySize,
      workEmail: company.workEmail,
      contactName: company.contactName,
      phone: company.phone,
      country: company.country,
      city: company.city,
      brn: company.brn,
      taxId: company.taxId,
      isVerified: company.isVerified,
      onboardingComplete: company.onboardingComplete,
      createdAt: company.createdAt,
    },
    admin: adminUser
      ? {
          id: adminUser._id,
          email: adminUser.email,
        }
      : null,
    onboarding: {
      id: onboarding._id,
      status: onboarding.status,
      basicInfo: onboarding.basicInfo,
      registration: onboarding.registration,
      documents: Object.fromEntries(onboarding.documents || []),
      documentReviews: mapDocumentReviews(onboarding),
      certified: onboarding.certified,
      rejectionReason: onboarding.rejectionReason || '',
      reviewedAt: onboarding.reviewedAt,
      submittedAt: onboarding.updatedAt,
      createdAt: onboarding.createdAt,
    },
  };
}

export async function getDashboardStats() {
  const [
    pending,
    approved,
    rejected,
    draft,
    total,
    totalEmployees,
    employeesProfileComplete,
    employeesVerified,
    aadhaarPending,
    demoRequestsNew,
  ] = await Promise.all([
    CompanyOnboarding.countDocuments({ status: 'submitted' }),
    CompanyOnboarding.countDocuments({ status: 'approved' }),
    CompanyOnboarding.countDocuments({ status: 'rejected' }),
    CompanyOnboarding.countDocuments({ status: 'draft' }),
    CompanyOnboarding.countDocuments({}),
    User.countDocuments({ role: 'employee' }),
    EmployeeProfile.countDocuments({ profileSetupComplete: true }),
    EmployeeProfile.countDocuments({ aadhaarVerified: true, biometricVerified: true }),
    AadhaarVerification.countDocuments({ status: 'pending' }),
    countNewDemoRequests(),
  ]);

  return {
    pending,
    approved,
    rejected,
    draft,
    total,
    totalEmployees,
    employeesProfileComplete,
    employeesVerified,
    aadhaarPending,
    demoRequestsNew,
  };
}

function formatEducation(education) {
  if (!education) {
    return {
      class10: { board: '', school: '', passingYear: '', percentage: '' },
      class12: { board: '', school: '', stream: '', passingYear: '', percentage: '' },
      graduation: { degree: '', college: '', university: '', passingYear: '', percentage: '' },
    };
  }

  return {
    class10: {
      board: education.class10?.board || '',
      school: education.class10?.school || '',
      passingYear: education.class10?.passingYear || '',
      percentage: education.class10?.percentage || '',
    },
    class12: {
      board: education.class12?.board || '',
      school: education.class12?.school || '',
      stream: education.class12?.stream || '',
      passingYear: education.class12?.passingYear || '',
      percentage: education.class12?.percentage || '',
    },
    graduation: {
      degree: education.graduation?.degree || '',
      college: education.graduation?.college || '',
      university: education.graduation?.university || '',
      passingYear: education.graduation?.passingYear || '',
      percentage: education.graduation?.percentage || '',
    },
  };
}

function formatEmployeeListItem(profile, user, linkedCompanies = []) {
  const verified = Boolean(profile.aadhaarVerified && profile.biometricVerified);

  return {
    id: profile.userId,
    userId: profile.userId,
    profileId: profile._id,
    name: profile.name || 'New User',
    email: profile.email || user?.email || '',
    phone: profile.phone || user?.phone || '',
    role: profile.role || 'Professional',
    company: profile.company || 'Not set',
    veriworkId: profile.veriworkId,
    publicSlug: profile.publicSlug,
    initials: getInitials(profile.name),
    photoUrl: profile.photoUrl,
    profileSetupComplete: profile.profileSetupComplete,
    aadhaarVerified: profile.aadhaarVerified,
    biometricVerified: profile.biometricVerified,
    isVerified: verified,
    employeeScore: profile.scoreCached ?? 300,
    currentCity: profile.currentCity || '',
    linkedCompanies,
    isActive: user?.isActive !== false,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function formatEmployeeDetail(profile, user, linkedCompanies = []) {
  const listItem = formatEmployeeListItem(profile, user, linkedCompanies);

  return {
    ...listItem,
    dateOfBirth: profile.dateOfBirth || '',
    gender: profile.gender || '',
    totalExperience: profile.totalExperience || '',
    currentAddress: profile.currentAddress || '',
    permanentAddress: profile.permanentAddress || '',
    education: formatEducation(profile.education),
    skills: profile.skills || [],
    endorsements: profile.endorsements || 0,
    digilockerUsed: profile.digilockerUsed,
    publicProfileEnabled: profile.publicProfileEnabled ?? true,
    authProvider: user?.authProvider || 'phone',
  };
}

function buildEmployeeProfileFilter({ q, status } = {}) {
  const filter = {};

  if (status === 'complete') filter.profileSetupComplete = true;
  if (status === 'incomplete') filter.profileSetupComplete = false;
  if (status === 'verified') {
    filter.aadhaarVerified = true;
    filter.biometricVerified = true;
  }

  if (q?.trim()) {
    const escaped = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');
    filter.$or = [
      { name: regex },
      { email: regex },
      { phone: regex },
      { veriworkId: regex },
      { company: regex },
      { currentCity: regex },
    ];
  }

  return filter;
}

async function loadLinkedCompanies(userIds) {
  if (!userIds.length) return new Map();

  const joinRequests = await JoinRequest.find({
    candidateUserId: { $in: userIds },
    status: 'approved',
  })
    .populate('companyId', 'name')
    .lean();

  const companyMap = new Map();
  for (const request of joinRequests) {
    const uid = request.candidateUserId?.toString();
    const name = request.companyId?.name;
    if (!uid || !name) continue;
    if (!companyMap.has(uid)) companyMap.set(uid, []);
    companyMap.get(uid).push(name);
  }

  return companyMap;
}

export async function listEmployees({ q, status } = {}) {
  const profiles = await EmployeeProfile.find(buildEmployeeProfileFilter({ q, status }))
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  const userIds = profiles.map((profile) => profile.userId);
  const [users, companyMap] = await Promise.all([
    User.find({ _id: { $in: userIds }, role: 'employee' }).lean(),
    loadLinkedCompanies(userIds),
  ]);

  const userMap = new Map(users.map((user) => [user._id.toString(), user]));

  return profiles
    .filter((profile) => userMap.has(profile.userId.toString()))
    .map((profile) => formatEmployeeListItem(
      profile,
      userMap.get(profile.userId.toString()),
      companyMap.get(profile.userId.toString()) || [],
    ));
}

export async function getEmployee(userId) {
  const user = await User.findOne({ _id: userId, role: 'employee' }).lean();
  if (!user) throw ApiError.notFound('Employee not found');

  const profile = await EmployeeProfile.findOne({ userId }).lean();
  if (!profile) throw ApiError.notFound('Employee profile not found');

  const [companyMap, aadhaar] = await Promise.all([
    loadLinkedCompanies([userId]),
    AadhaarVerification.findOne({ userId }).lean(),
  ]);

  return {
    ...formatEmployeeDetail(profile, user, companyMap.get(userId.toString()) || []),
    // Summary only — the full number and card images live behind the
    // Aadhaar review screen.
    aadhaarKyc: aadhaar
      ? {
          id: aadhaar._id,
          status: aadhaar.status,
          aadhaarMasked: `XXXX XXXX ${aadhaar.aadhaarLast4}`,
          nameOnAadhaar: aadhaar.nameOnAadhaar,
          submittedAt: aadhaar.submittedAt,
          reviewedAt: aadhaar.reviewedAt,
          rejectionReason: aadhaar.rejectionReason || '',
          faceMatchSimilarity: aadhaar.faceMatch?.similarity || 0,
          faceMatchMatched: aadhaar.faceMatch?.matched || false,
        }
      : null,
  };
}

/**
 * Load the employee behind an admin action, rejecting anything that isn't a
 * real employee account — a platform admin or company user must never be
 * reachable through the employee endpoints.
 */
async function requireEmployeeUser(userId) {
  const validId = assertValidObjectId(userId, 'employee id');
  const user = await User.findOne({ _id: validId, role: 'employee' });
  if (!user) throw ApiError.notFound('Employee not found');
  return user;
}

/**
 * Deactivate or restore an employee account.
 *
 * The reversible half of "remove this employee": `isActive:false` is what the
 * auth middleware already checks, so the account stops being able to log in
 * immediately, while every verification record companies rely on stays intact.
 * Deactivating also revokes refresh tokens, otherwise a session issued minutes
 * ago would keep working until its access token expired.
 */
export async function setEmployeeActive(adminUserId, userId, isActive) {
  const user = await requireEmployeeUser(userId);
  const next = Boolean(isActive);

  if (user.isActive === next) {
    return { id: user._id, isActive: next, changed: false };
  }

  user.isActive = next;
  await user.save();

  if (!next) {
    await RefreshToken.updateMany(
      { userId: user._id, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
  }

  console.log(
    `[admin] ${next ? 'reactivated' : 'deactivated'} employee ${user._id} by admin ${adminUserId}`,
  );

  return { id: user._id, isActive: next, changed: true };
}

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
 *
 * This is the irreversible half of removal — for spam/test accounts and for
 * "delete my data" requests — so it is deliberately awkward to trigger:
 * `confirm` must match the employee's own name or PagerLook ID, which the
 * caller can only know by having the right record open.
 *
 * Records other companies hold about this person go too (verification requests,
 * endorsements, roster entries), because a half-erased employee still leaves
 * their name and history sitting in someone else's dashboard.
 *
 * Deliberately NOT run in a transaction: that would need a replica set and
 * would break local single-node development. Instead the User row is deleted
 * last, so a failure part-way leaves the account still visible in the console
 * and the purge simply re-runnable, rather than orphaning data behind a
 * vanished user.
 */
export async function deleteEmployee(adminUserId, userId, { confirm } = {}) {
  const user = await requireEmployeeUser(userId);
  const profile = await EmployeeProfile.findOne({ userId: user._id }).lean();

  const expected = [profile?.name, profile?.veriworkId, user.email]
    .filter(Boolean)
    .map((value) => value.trim().toLowerCase());
  const given = String(confirm || '').trim().toLowerCase();

  if (!given || !expected.includes(given)) {
    throw ApiError.badRequest(
      "Type the employee's name or PagerLook ID exactly to confirm permanent deletion",
    );
  }

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
    RefreshToken.deleteMany({ userId: id }),
    EmployeeProfile.deleteMany({ userId: id }),
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
    refreshTokens: refreshTokens.deletedCount,
    profiles: profiles.deletedCount,
    files: filesDeleted,
  };

  // There is no platform-level audit collection, and the employee's own
  // ActivityLog rows are gone — so this line is the only lasting record that
  // the deletion happened. Keep it structured and greppable.
  console.log(
    `[admin] PERMANENTLY DELETED employee ${id} (${profile?.veriworkId || 'no id'}) ` +
      `by admin ${adminUserId} :: ${JSON.stringify(counts)}`,
  );

  return {
    id,
    deleted: true,
    name: profile?.name || '',
    veriworkId: profile?.veriworkId || '',
    counts,
  };
}

export async function listCompanyApplications(status) {
  const filter = status ? { status } : {};

  const onboardings = await CompanyOnboarding.find(filter)
    .sort({ updatedAt: -1 });

  const companyIds = onboardings.map((o) => o.companyId);
  const companies = await Company.find({ _id: { $in: companyIds } });
  const companyMap = new Map(companies.map((c) => [c._id.toString(), c]));

  const adminUsers = await User.find({
    companyId: { $in: companyIds },
    role: 'enterprise_admin',
  });
  const adminMap = new Map(adminUsers.map((u) => [u.companyId.toString(), u]));

  return onboardings
    .map((onboarding) => {
      const company = companyMap.get(onboarding.companyId.toString());
      if (!company) return null;
      return formatCompanyApplication(
        company,
        onboarding,
        adminMap.get(onboarding.companyId.toString()),
      );
    })
    .filter(Boolean);
}

export async function getCompanyApplication(companyId) {
  const [company, onboarding] = await Promise.all([
    Company.findById(companyId),
    CompanyOnboarding.findOne({ companyId }),
  ]);

  if (!company || !onboarding) {
    throw ApiError.notFound('Company application not found');
  }

  const adminUser = await User.findOne({ companyId, role: 'enterprise_admin' });
  return formatCompanyApplication(company, onboarding, adminUser);
}

export async function reviewCompanyApplication(adminUserId, companyId, { status, reason }) {
  const [company, onboarding] = await Promise.all([
    Company.findById(companyId),
    CompanyOnboarding.findOne({ companyId }),
  ]);

  if (!company || !onboarding) {
    throw ApiError.notFound('Company application not found');
  }

  if (onboarding.status !== 'submitted') {
    throw ApiError.badRequest('Only submitted applications can be reviewed');
  }

  if (status === 'approved') {
    onboarding.status = 'approved';
    onboarding.rejectionReason = '';
    onboarding.reviewedAt = new Date();
    onboarding.reviewedBy = adminUserId;
    company.isVerified = true;
    company.onboardingComplete = true;
  } else if (status === 'rejected') {
    onboarding.status = 'rejected';
    onboarding.rejectionReason = reason || 'Application rejected by admin';
    onboarding.reviewedAt = new Date();
    onboarding.reviewedBy = adminUserId;
    company.isVerified = false;
    company.onboardingComplete = false;
  } else {
    throw ApiError.badRequest('Status must be approved or rejected');
  }

  await Promise.all([company.save(), onboarding.save()]);

  const adminUser = await User.findOne({ companyId, role: 'enterprise_admin' });

  return {
    message: status === 'approved'
      ? 'Company approved successfully'
      : 'Company application rejected',
    application: formatCompanyApplication(company, onboarding, adminUser),
  };
}
