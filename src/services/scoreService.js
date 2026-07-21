import { VERIFICATION_LEVEL_WEIGHTS } from './verificationTagsService.js';

export const SCORE_MIN = 300;
export const SCORE_MAX = 1000;

const JOB_LEVEL_POINTS = {
  document_verified: 80,
  hr_verified: 130,
  employer_verified: 180,
};

function getJobVerificationPoints(job) {
  if (!job) return 0;
  if (job.verificationLevel && JOB_LEVEL_POINTS[job.verificationLevel]) {
    return JOB_LEVEL_POINTS[job.verificationLevel];
  }
  if (job.status === 'verified') return JOB_LEVEL_POINTS.document_verified;
  if (job.status === 'in_process') return 20;
  return 0;
}

/** Points per completed education level — skippable at setup, earned when added. */
export const EDUCATION_LEVEL_POINTS = 15;

/** A level counts once its two identifying fields are filled. */
export function countCompletedEducationLevels(education) {
  if (!education) return 0;
  const levels = [
    ['board', 'school'], // class10
    ['board', 'school'], // class12
    ['degree', 'college'], // graduation
  ];
  const entries = [education.class10, education.class12, education.graduation];

  return entries.reduce((count, level, i) => {
    if (!level) return count;
    const complete = levels[i].every((field) => level[field]?.trim());
    return complete ? count + 1 : count;
  }, 0);
}

export function calculateEmployeeScore(profile, jobs = []) {
  if (!profile) return SCORE_MIN;

  let score = SCORE_MIN;

  if (profile.profileSetupComplete) {
    score += VERIFICATION_LEVEL_WEIGHTS.profile_verified;
  }

  // Education is optional, so it adds on top rather than gating anything.
  score += countCompletedEducationLevels(profile.education) * EDUCATION_LEVEL_POINTS;

  const identityVerified = profile.aadhaarVerified && profile.biometricVerified;
  if (identityVerified) {
    score += VERIFICATION_LEVEL_WEIGHTS.identity_verified;
    if (profile.digilockerUsed) score += 25;
  }

  for (const job of jobs) {
    score += getJobVerificationPoints(job);
  }

  score += Math.min((profile.endorsements || 0) * 8, 60);

  return Math.min(SCORE_MAX, Math.max(SCORE_MIN, Math.round(score)));
}

export function getScoreRating(score) {
  if (score >= 850) {
    return {
      label: 'Excellent',
      tier: 'A+',
      description: 'Top-tier verified professional. Highly trusted by employers.',
    };
  }
  if (score >= 700) {
    return {
      label: 'Good',
      tier: 'A',
      description: 'Strong identity and employment verification. Reliable for hiring.',
    };
  }
  if (score >= 550) {
    return {
      label: 'Fair',
      tier: 'B',
      description: 'Building trust. Complete verification and job records to improve.',
    };
  }
  if (score >= 400) {
    return {
      label: 'Developing',
      tier: 'C',
      description: 'Early stage profile. Finish identity and employment verification.',
    };
  }
  return {
    label: 'New',
    tier: '—',
    description: 'Start verification to build your Employee Score.',
  };
}

export function getScoreFactors(profile, jobs = []) {
  const identityVerified = profile?.aadhaarVerified && profile?.biometricVerified;
  const verifiedJobs = jobs.filter((j) => j.status === 'verified' || j.verificationLevel !== 'none').length;
  const jobPoints = jobs.reduce((sum, j) => sum + getJobVerificationPoints(j), 0);

  return [
    {
      id: 'profile',
      label: 'Profile verified',
      points: profile?.profileSetupComplete ? VERIFICATION_LEVEL_WEIGHTS.profile_verified : 0,
      max: VERIFICATION_LEVEL_WEIGHTS.profile_verified,
      tip: 'Complete your profile setup',
      done: Boolean(profile?.profileSetupComplete),
    },
    {
      id: 'identity',
      label: 'Identity verified',
      points: identityVerified
        ? VERIFICATION_LEVEL_WEIGHTS.identity_verified + (profile.digilockerUsed ? 25 : 0)
        : 0,
      max: VERIFICATION_LEVEL_WEIGHTS.identity_verified + 25,
      tip: 'Verify Aadhaar + biometric liveness',
      done: identityVerified,
    },
    {
      id: 'employment',
      label: 'Employment verification',
      points: jobPoints,
      max: 360,
      tip: 'Verify jobs — Document → HR → Employer verified tiers',
      done: verifiedJobs > 0,
    },
    {
      id: 'endorsements',
      label: 'Peer endorsements',
      points: Math.min((profile?.endorsements || 0) * 8, 60),
      max: 60,
      tip: 'Get endorsed by colleagues and managers',
      done: (profile?.endorsements || 0) > 0,
    },
  ];
}

export function getScorePercentile(score) {
  if (score >= 850) return 'Top 5% of professionals';
  if (score >= 700) return 'Top 20% of professionals';
  if (score >= 550) return 'Top 45% of professionals';
  if (score >= 400) return 'Building your ranking';
  return 'Not yet ranked';
}

export function getVerificationPercent(profile) {
  let percent = 0;
  if (profile.profileSetupComplete) percent += 25;
  if (profile.aadhaarVerified) percent += 25;
  if (profile.biometricVerified) percent += 25;
  if (profile.panVerified) percent += 25;
  return Math.min(100, percent);
}

export function isVerificationComplete(profile) {
  return Boolean(
    profile.profileSetupComplete
    && profile.aadhaarVerified
    && profile.biometricVerified,
  );
}

export function getCurrentVerificationStep(profile) {
  if (!profile.profileSetupComplete) return 'profile';
  if (!profile.aadhaarVerified) return 'aadhaar';
  if (!profile.biometricVerified) return 'biometric';
  return 'complete';
}
