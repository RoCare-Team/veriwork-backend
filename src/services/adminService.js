import { Company } from '../models/Company.js';
import { CompanyOnboarding } from '../models/CompanyOnboarding.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';

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
      certified: onboarding.certified,
      rejectionReason: onboarding.rejectionReason || '',
      reviewedAt: onboarding.reviewedAt,
      submittedAt: onboarding.updatedAt,
      createdAt: onboarding.createdAt,
    },
  };
}

export async function getDashboardStats() {
  const [pending, approved, rejected, draft, total] = await Promise.all([
    CompanyOnboarding.countDocuments({ status: 'submitted' }),
    CompanyOnboarding.countDocuments({ status: 'approved' }),
    CompanyOnboarding.countDocuments({ status: 'rejected' }),
    CompanyOnboarding.countDocuments({ status: 'draft' }),
    CompanyOnboarding.countDocuments({}),
  ]);

  return {
    pending,
    approved,
    rejected,
    draft,
    total,
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
