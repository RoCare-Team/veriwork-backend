export const VERIFICATION_STATUSES = {
  PENDING: 'pending',
  IN_REVIEW: 'in_review',
  HR_RESPONDED: 'hr_responded',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
};

export const OPEN_STATUSES = ['pending_employee_consent', 'pending', 'in_review', 'in_process', 'hr_responded'];

export const COMPLETED_VERIFIED_STATUSES = ['verified', 'approved'];

export function normalizeVerificationStatus(status, verificationResult = null) {
  if (status === 'pending_employee_consent') return 'pending_employee_consent';
  if (status === 'in_process') return VERIFICATION_STATUSES.IN_REVIEW;
  if (status === 'hr_responded') return VERIFICATION_STATUSES.HR_RESPONDED;
  if (status === 'approved' && verificationResult === 'verified') return VERIFICATION_STATUSES.VERIFIED;
  if (status === 'approved') return VERIFICATION_STATUSES.VERIFIED;
  if (status === 'rejected') return VERIFICATION_STATUSES.REJECTED;
  if (status === 'expired') return VERIFICATION_STATUSES.EXPIRED;
  if (status === 'in_review') return VERIFICATION_STATUSES.IN_REVIEW;
  if (status === 'verified') return VERIFICATION_STATUSES.VERIFIED;
  return status || VERIFICATION_STATUSES.PENDING;
}

export function getVerificationStatusLabel(status) {
  const normalized = normalizeVerificationStatus(status);
  const labels = {
    pending_employee_consent: 'Awaiting Your Consent',
    pending: 'Pending',
    in_review: 'In Review',
    hr_responded: 'HR Responded — Awaiting Review',
    verified: 'Verified',
    rejected: 'Rejected',
    expired: 'Expired',
  };
  return labels[normalized] || status;
}

export function isRequestOpen(request) {
  if (!request) return false;
  if (request.status === 'expired') return false;
  if (request.externalTokenExpiresAt && request.externalTokenExpiresAt < new Date()) {
    return false;
  }
  return OPEN_STATUSES.includes(request.status);
}

export async function markExpiredIfNeeded(request) {
  if (!request?.externalTokenExpiresAt) return request;
  if (request.status === 'expired') return request;
  if (!['pending', 'in_review', 'in_process'].includes(request.status)) return request;

  if (request.externalTokenExpiresAt < new Date()) {
    request.status = 'expired';
    await request.save();
  }
  return request;
}
