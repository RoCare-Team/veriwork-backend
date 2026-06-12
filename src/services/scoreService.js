export const SCORE_MIN = 300;
export const SCORE_MAX = 900;

export function calculateEmployeeScore(profile, jobs = []) {
  if (!profile) return SCORE_MIN;

  let score = SCORE_MIN;

  if (profile.profileSetupComplete) score += 50;
  if (profile.aadhaarVerified) score += 120;
  if (profile.biometricVerified) score += 130;
  if (profile.digilockerUsed) score += 25;

  const verifiedJobs = jobs.filter((j) => j.status === 'verified').length;
  const pendingJobs = jobs.filter((j) => j.status === 'in_process').length;

  score += verifiedJobs * 45;
  score += pendingJobs * 12;
  score += Math.min(jobs.length * 8, 40);
  score += Math.min((profile.endorsements || 0) * 8, 60);

  return Math.min(SCORE_MAX, Math.max(SCORE_MIN, Math.round(score)));
}

export function getScoreRating(score) {
  if (score >= 800) {
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
      description: 'Strong identity and work history. Reliable for hiring decisions.',
    };
  }
  if (score >= 600) {
    return {
      label: 'Fair',
      tier: 'B',
      description: 'Building trust. Complete verification and job records to improve.',
    };
  }
  if (score >= 450) {
    return {
      label: 'Developing',
      tier: 'C',
      description: 'Early stage profile. Finish identity verification to unlock score.',
    };
  }
  return {
    label: 'New',
    tier: '—',
    description: 'Start verification to build your Employee Score.',
  };
}

export function getScoreFactors(profile, jobs = []) {
  const verifiedJobs = jobs.filter((j) => j.status === 'verified').length;
  const pendingJobs = jobs.filter((j) => j.status === 'in_process').length;

  return [
    {
      id: 'profile',
      label: 'Profile completeness',
      points: profile?.profileSetupComplete ? 50 : 0,
      max: 50,
      tip: 'Add your name and professional role',
      done: Boolean(profile?.profileSetupComplete),
    },
    {
      id: 'aadhaar',
      label: 'Aadhaar verification',
      points: profile?.aadhaarVerified ? 120 + (profile.digilockerUsed ? 25 : 0) : 0,
      max: 145,
      tip: 'Verify via DigiLocker for maximum points',
      done: Boolean(profile?.aadhaarVerified),
    },
    {
      id: 'biometric',
      label: 'Biometric liveness',
      points: profile?.biometricVerified ? 130 : 0,
      max: 130,
      tip: 'Complete face match with your ID photo',
      done: Boolean(profile?.biometricVerified),
    },
    {
      id: 'jobs',
      label: 'Employment records',
      points: verifiedJobs * 45 + pendingJobs * 12 + Math.min(jobs.length * 8, 40),
      max: 200,
      tip: 'Add and verify job history to boost score',
      done: jobs.length > 0,
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
  if (score >= 800) return 'Top 5% of professionals';
  if (score >= 700) return 'Top 20% of professionals';
  if (score >= 600) return 'Top 45% of professionals';
  if (score >= 450) return 'Building your ranking';
  return 'Not yet ranked';
}

export function getVerificationPercent(profile) {
  let percent = 0;
  if (profile.profileSetupComplete) percent += 33;
  if (profile.aadhaarVerified) percent += 33;
  if (profile.biometricVerified) percent += 34;
  return percent;
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
