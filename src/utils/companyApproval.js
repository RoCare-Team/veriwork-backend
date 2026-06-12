import { Company } from '../models/Company.js';
import { CompanyOnboarding } from '../models/CompanyOnboarding.js';
import { ApiError } from '../utils/ApiError.js';

export function getEnterpriseHomeRoute(onboarding, company) {
  if (!onboarding) return '/enterprise/register';

  if (onboarding.status === 'approved' && company?.isVerified) {
    return '/enterprise/dashboard';
  }
  if (onboarding.status === 'submitted') {
    return '/enterprise/pending-approval';
  }
  if (onboarding.status === 'rejected') {
    return '/enterprise/rejected';
  }
  return '/enterprise/verify';
}

export async function getCompanyApprovalStatus(companyId) {
  const [company, onboarding] = await Promise.all([
    Company.findById(companyId),
    CompanyOnboarding.findOne({ companyId }),
  ]);

  if (!company || !onboarding) {
    return { isApproved: false, status: 'draft', onboarding: null, company: null };
  }

  return {
    isApproved: onboarding.status === 'approved' && company.isVerified,
    status: onboarding.status,
    rejectionReason: onboarding.rejectionReason || '',
    onboarding,
    company,
  };
}

export async function assertCompanyApproved(companyId) {
  const approval = await getCompanyApprovalStatus(companyId);

  if (approval.status === 'submitted') {
    throw ApiError.forbidden('Your company registration is pending admin approval');
  }
  if (approval.status === 'rejected') {
    throw ApiError.forbidden(
      approval.rejectionReason
        ? `Company registration was rejected: ${approval.rejectionReason}`
        : 'Company registration was rejected. Please contact support.',
    );
  }
  if (!approval.isApproved) {
    throw ApiError.forbidden('Please complete company verification and wait for admin approval');
  }

  return approval;
}
