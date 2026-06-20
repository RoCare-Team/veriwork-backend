export const VERIFICATION_LEVEL_WEIGHTS = {
  profile_verified: 100,
  identity_verified: 200,
  document_verified: 150,
  hr_verified: 250,
  employer_verified: 300,
};

export const VERIFICATION_TAG_LABELS = {
  none: 'Not Verified',
  profile_verified: 'Profile Verified',
  identity_verified: 'Identity Verified',
  document_verified: 'Document Verified',
  hr_verified: 'HR Verified',
  employer_verified: 'Employer Verified',
};

export function getVerificationTagLabel(level) {
  return VERIFICATION_TAG_LABELS[level] || level || 'Not Verified';
}

export function getJobVerificationTag(job) {
  if (!job) return { id: 'none', label: 'Not Verified' };
  const level = job.verificationLevel && job.verificationLevel !== 'none'
    ? job.verificationLevel
    : job.status === 'verified'
      ? 'document_verified'
      : 'none';
  return { id: level, label: getVerificationTagLabel(level) };
}

export function computeProfileVerificationTags(profile, jobs = [], documents = []) {
  const tags = [];
  let cumulativeScore = 0;

  if (profile?.profileSetupComplete) {
    tags.push({ id: 'profile_verified', label: 'Profile Verified', weight: VERIFICATION_LEVEL_WEIGHTS.profile_verified });
    cumulativeScore += VERIFICATION_LEVEL_WEIGHTS.profile_verified;
  }

  const identityComplete = profile?.aadhaarVerified && profile?.panVerified && profile?.biometricVerified;
  if (identityComplete) {
    tags.push({ id: 'identity_verified', label: 'Identity Verified', weight: VERIFICATION_LEVEL_WEIGHTS.identity_verified });
    cumulativeScore += VERIFICATION_LEVEL_WEIGHTS.identity_verified;
  }

  const jobLevels = jobs.map((j) => j.verificationLevel).filter(Boolean);
  if (jobLevels.includes('employer_verified')) {
    tags.push({ id: 'employer_verified', label: 'Employer Verified', weight: VERIFICATION_LEVEL_WEIGHTS.employer_verified });
    cumulativeScore += VERIFICATION_LEVEL_WEIGHTS.employer_verified;
  } else if (jobLevels.includes('hr_verified')) {
    tags.push({ id: 'hr_verified', label: 'HR Verified', weight: VERIFICATION_LEVEL_WEIGHTS.hr_verified });
    cumulativeScore += VERIFICATION_LEVEL_WEIGHTS.hr_verified;
  } else if (jobLevels.includes('document_verified') || documents.length > 0) {
    tags.push({ id: 'document_verified', label: 'Document Verified', weight: VERIFICATION_LEVEL_WEIGHTS.document_verified });
    cumulativeScore += VERIFICATION_LEVEL_WEIGHTS.document_verified;
  }

  return {
    tags,
    cumulativeScore: Math.min(1000, cumulativeScore),
    maxScore: 1000,
    highestLevel: tags.length ? tags[tags.length - 1].id : 'none',
  };
}
