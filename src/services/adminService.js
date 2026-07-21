import { Company } from '../models/Company.js';
import { CompanyOnboarding } from '../models/CompanyOnboarding.js';
import { EmployeeProfile } from '../models/EmployeeProfile.js';
import { JoinRequest } from '../models/JoinRequest.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { getInitials } from '../utils/idGenerators.js';
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
  ] = await Promise.all([
    CompanyOnboarding.countDocuments({ status: 'submitted' }),
    CompanyOnboarding.countDocuments({ status: 'approved' }),
    CompanyOnboarding.countDocuments({ status: 'rejected' }),
    CompanyOnboarding.countDocuments({ status: 'draft' }),
    CompanyOnboarding.countDocuments({}),
    User.countDocuments({ role: 'employee' }),
    EmployeeProfile.countDocuments({ profileSetupComplete: true }),
    EmployeeProfile.countDocuments({ aadhaarVerified: true, biometricVerified: true }),
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

  const companyMap = await loadLinkedCompanies([userId]);
  return formatEmployeeDetail(profile, user, companyMap.get(userId.toString()) || []);
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
