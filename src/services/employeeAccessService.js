import { AccessRequest } from '../models/AccessRequest.js';
import { ApiError } from '../utils/ApiError.js';

const APPROVED_STATUSES = ['approved', 'accepted'];

export const ACCESS_TYPES = {
  PROFILE: 'profile_access',
  BACKGROUND: 'background_check',
  VERIFICATION: 'verification_data',
  FULL_PROFILE: 'full_profile_access',
};

export const ACCESS_LABELS = {
  profile_access: 'Profile Access',
  background_check: 'Background Check',
  verification_data: 'Verification Data',
  full_profile_access: 'Get Full Profile Access',
};

export async function getEmployeeAccessGrants(companyId, employeeId) {
  const [approved, pending] = await Promise.all([
    AccessRequest.find({
      companyId,
      $or: [{ employeeId }, { employeeUserId: employeeId }],
      status: { $in: APPROVED_STATUSES },
    }),
    AccessRequest.find({
      companyId,
      $or: [{ employeeId }, { employeeUserId: employeeId }],
      status: 'pending',
    }),
  ]);

  const hasType = (type) => approved.some((r) => r.requestType === type);
  const pendingType = (type) => pending.some((r) => r.requestType === type);
  const approvedOfType = (type) => approved.filter((r) => r.requestType === type);

  const fullProfileAccess = hasType(ACCESS_TYPES.FULL_PROFILE);

  return {
    fullProfileAccess,
    profileAccess: fullProfileAccess || hasType(ACCESS_TYPES.PROFILE),
    backgroundCheck: fullProfileAccess || hasType(ACCESS_TYPES.BACKGROUND),
    verificationData: fullProfileAccess || hasType(ACCESS_TYPES.VERIFICATION),
    pendingFullProfileAccess: pendingType(ACCESS_TYPES.FULL_PROFILE),
    pendingProfileAccess: pendingType(ACCESS_TYPES.PROFILE),
    pendingBackgroundCheck: pendingType(ACCESS_TYPES.BACKGROUND),
    pendingVerificationData: pendingType(ACCESS_TYPES.VERIFICATION),
    hasAnyAccess: approved.length > 0,
    hasAllAccess: fullProfileAccess || (
      hasType(ACCESS_TYPES.PROFILE)
      && hasType(ACCESS_TYPES.BACKGROUND)
      && hasType(ACCESS_TYPES.VERIFICATION)
    ),
    showFullProfileButton: fullProfileAccess,
    approvedRequests: approved.map((r) => ({
      id: r._id,
      requestType: r.requestType,
      label: ACCESS_LABELS[r.requestType] || r.requestType,
      respondedAt: r.respondedAt,
    })),
    pendingRequests: pending.map((r) => ({
      id: r._id,
      requestType: r.requestType,
      label: ACCESS_LABELS[r.requestType] || r.requestType,
      requestedAt: r.requestedAt || r.createdAt,
    })),
    approvedByType: {
      profile_access: approvedOfType(ACCESS_TYPES.PROFILE).map((r) => r._id),
      background_check: approvedOfType(ACCESS_TYPES.BACKGROUND).map((r) => r._id),
      verification_data: approvedOfType(ACCESS_TYPES.VERIFICATION).map((r) => r._id),
      full_profile_access: approvedOfType(ACCESS_TYPES.FULL_PROFILE).map((r) => r._id),
    },
  };
}

export async function requireEmployeeAccess(companyId, employeeId, requestType) {
  const grants = await getEmployeeAccessGrants(companyId, employeeId);

  if (grants.fullProfileAccess) return grants;

  const map = {
    [ACCESS_TYPES.PROFILE]: grants.profileAccess,
    [ACCESS_TYPES.BACKGROUND]: grants.backgroundCheck,
    [ACCESS_TYPES.VERIFICATION]: grants.verificationData,
    [ACCESS_TYPES.FULL_PROFILE]: grants.fullProfileAccess,
  };

  if (!map[requestType]) {
    throw ApiError.forbidden(
      `Employee has not approved ${ACCESS_LABELS[requestType] || requestType}. Send an access request and wait for consent.`,
    );
  }

  return grants;
}

export function getConsentScope(requestType) {
  switch (requestType) {
    case ACCESS_TYPES.FULL_PROFILE:
      return [
        'basic_details',
        'contact_info',
        'employment_history',
        'skills',
        'vault_documents',
        'job_documents',
        'document_metadata',
        'document_files',
        'verification_status',
        'identity_verification',
        'trust_score_breakdown',
        'verification_levels',
        'profile_details',
      ];
    case ACCESS_TYPES.PROFILE:
      return ['basic_details', 'contact_info', 'employment_history', 'skills'];
    case ACCESS_TYPES.BACKGROUND:
      return ['vault_documents', 'job_documents', 'document_metadata', 'document_files'];
    case ACCESS_TYPES.VERIFICATION:
      return ['verification_status', 'identity_verification', 'trust_score_breakdown', 'verification_levels'];
    default:
      return [];
  }
}

export function getAccessRequestTitle(requestType) {
  switch (requestType) {
    case ACCESS_TYPES.FULL_PROFILE:
      return 'Company full profile access request';
    case ACCESS_TYPES.BACKGROUND:
      return 'Company background check access request';
    case ACCESS_TYPES.VERIFICATION:
      return 'Company verification data access request';
    default:
      return 'Company profile access request';
  }
}

export function getAccessRequestMessage(companyName, requestType, previousEmployerName = '') {
  switch (requestType) {
    case ACCESS_TYPES.FULL_PROFILE:
      if (previousEmployerName) {
        return `${companyName} is requesting access to your employment records, verification history, and documents from ${previousEmployerName}.`;
      }
      return `${companyName} requested full access to your profile, documents, and verification records`;
    case ACCESS_TYPES.BACKGROUND:
      return `${companyName} requested access to your documents and background records`;
    case ACCESS_TYPES.VERIFICATION:
      return `${companyName} requested access to your verification status and trust data`;
    default:
      return `${companyName} requested access to your profile details`;
  }
}
