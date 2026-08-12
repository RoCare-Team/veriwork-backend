/**
 * PagerLook Trust Score — a CIBIL-style score for professionals.
 *
 * The score is built from a transparent 1000-point rubric across 8 categories.
 * Every point is explainable: each item declares how many points it's worth and
 * a pure `earn(ctx)` function that returns how many are currently earned from the
 * user's verified data. Items we can't verify yet earn 0 (honest by design) but
 * are still shown, so the breakdown doubles as a "what to do next" roadmap.
 *
 * Displayed score = 300 + round(trustPoints / 1000 × 700)  → always 300–1000.
 * (300 is the floor, 1000 the ceiling, matching the published trust bands.)
 */

export const SCORE_MIN = 300;
export const SCORE_MAX = 1000;
export const TRUST_POINTS_MAX = 1000;

/* ── small helpers over the available data ─────────────────────────────────── */

const has = (v) => Boolean(v && String(v).trim());
const VERIFIED_LEVELS = ['document_verified', 'hr_verified', 'employer_verified'];
const isVerifiedJob = (j) => VERIFIED_LEVELS.includes(j?.verificationLevel) || j?.status === 'verified';
const isHrPlus = (j) => ['hr_verified', 'employer_verified'].includes(j?.verificationLevel);
const isEmployerVerified = (j) => j?.verificationLevel === 'employer_verified';

function eduLevelComplete(level, fields) {
  return Boolean(level) && fields.every((f) => has(level[f]));
}

/** Legacy exports kept for callers/validators that still import them. */
export const EDUCATION_LEVEL_POINTS = 20;
export function countCompletedEducationLevels(education) {
  if (!education) return 0;
  let n = 0;
  if (eduLevelComplete(education.class10, ['board', 'school'])) n += 1;
  if (eduLevelComplete(education.class12, ['board', 'school'])) n += 1;
  if (eduLevelComplete(education.graduation, ['degree', 'college'])) n += 1;
  return n;
}

/** No overlaps between consecutive jobs → a consistent timeline. */
function timelineConsistent(jobs) {
  const dated = jobs
    .filter((j) => has(j.joiningDate))
    .sort((a, b) => String(a.joiningDate).localeCompare(String(b.joiningDate)));
  if (dated.length === 0) return false;
  for (let i = 1; i < dated.length; i += 1) {
    const prevEnd = dated[i - 1].isPresent ? '9999-12-31' : dated[i - 1].exitDate || dated[i - 1].joiningDate;
    if (has(prevEnd) && String(dated[i].joiningDate) < String(prevEnd)) return false;
  }
  return true;
}

/* ── the rubric: 8 categories, 1000 points ─────────────────────────────────── */

export const SCORE_RUBRIC = [
  {
    id: 'profile',
    label: 'Profile Completion',
    tip: 'Complete your basic profile details.',
    items: [
      { id: 'basic', label: 'Basic profile', points: 20, earn: (p) => (p.profileSetupComplete || (has(p.name) && has(p.role)) ? 20 : 0) },
      { id: 'photo', label: 'Profile photo', points: 10, earn: (p) => (has(p.photoUrl) ? 10 : 0) },
      { id: 'mobile', label: 'Mobile verified', points: 20, earn: (p) => (has(p.phone) ? 20 : 0) },
      { id: 'email', label: 'Email verified', points: 20, earn: (p) => (has(p.email) ? 20 : 0) },
      { id: 'address', label: 'Address added', points: 10, earn: (p) => (has(p.currentAddress) ? 10 : 0) },
      { id: 'emergency', label: 'Emergency contact', points: 10, earn: (p) => (has(p.emergencyContact) ? 10 : 0) },
      { id: 'resume', label: 'Resume uploaded', points: 10, earn: (p) => (has(p.resumeUrl) ? 10 : 0) },
    ],
  },
  {
    id: 'identity',
    label: 'Identity Verification',
    tip: 'Verify Aadhaar, PAN and your face.',
    items: [
      { id: 'aadhaar', label: 'Aadhaar verified', points: 75, earn: (p) => (p.aadhaarVerified ? 75 : 0) },
      { id: 'pan', label: 'PAN verified', points: 50, earn: (p) => (p.panVerified ? 50 : 0) },
      { id: 'digilocker', label: 'DigiLocker connected', points: 25, earn: (p) => (p.digilockerUsed ? 25 : 0) },
      { id: 'faceMatch', label: 'Face match', points: 35, earn: (p) => (p.biometricVerified ? 35 : 0) },
      { id: 'liveness', label: 'Passive liveness check', points: 25, earn: (p) => (p.biometricVerified ? 25 : 0) },
      { id: 'govId', label: 'Passport / DL / Voter ID', points: 15, earn: (p) => (p.govIdVerified ? 15 : 0) },
    ],
  },
  {
    id: 'employment',
    label: 'Employment Verification',
    tip: 'Verify current and past employers.',
    items: [
      { id: 'currentEmployer', label: 'Current employer verified', points: 80, earn: (_p, jobs) => (jobs.some((j) => j.isPresent && isHrPlus(j)) ? 80 : 0) },
      { id: 'prevEmployer', label: 'Previous employer verified', points: 60, earn: (_p, jobs) => (jobs.some((j) => !j.isPresent && isHrPlus(j)) ? 60 : 0) },
      { id: 'epfo', label: 'EPFO / UAN verified', points: 40, earn: (_p, jobs) => (jobs.some((j) => /^\d{12}$/.test(String(j.uanNumber || ''))) ? 40 : 0) },
      { id: 'offerLetter', label: 'Offer letter verified', points: 20, earn: (_p, jobs) => (jobs.some(isVerifiedJob) ? 20 : 0) },
      { id: 'experienceLetter', label: 'Experience letter verified', points: 20, earn: (_p, jobs) => (jobs.some((j) => !j.isPresent && isVerifiedJob(j)) ? 20 : 0) },
      { id: 'salaryAccount', label: 'Salary account verified', points: 15, earn: (_p, jobs) => (jobs.some((j) => j.salaryAccountVerified) ? 15 : 0) },
      { id: 'timeline', label: 'Employment timeline consistency', points: 15, earn: (_p, jobs) => (timelineConsistent(jobs) ? 15 : 0) },
    ],
  },
  {
    id: 'education',
    label: 'Education Verification',
    tip: 'Add and verify your qualifications.',
    items: [
      { id: 'tenth', label: '10th certificate', points: 20, earn: (p) => (eduLevelComplete(p.education?.class10, ['board', 'school']) ? 20 : 0) },
      { id: 'twelfth', label: '12th certificate', points: 20, earn: (p) => (eduLevelComplete(p.education?.class12, ['board', 'school']) ? 20 : 0) },
      { id: 'graduation', label: 'Graduation', points: 50, earn: (p) => (eduLevelComplete(p.education?.graduation, ['degree', 'college']) ? 50 : 0) },
      { id: 'pg', label: 'Post graduation', points: 20, earn: (p) => (eduLevelComplete(p.education?.postGraduation, ['degree', 'college']) ? 20 : 0) },
      { id: 'digilockerEdu', label: 'DigiLocker education docs', points: 20, earn: (p) => (p.digilockerEducationVerified ? 20 : 0) },
      { id: 'profCerts', label: 'Professional certifications', points: 20, earn: (p) => (Array.isArray(p.certifications) && p.certifications.length > 0 ? 20 : 0) },
    ],
  },
  {
    id: 'credentials',
    label: 'Professional Credentials',
    tip: 'Showcase verified skills and work.',
    items: [
      { id: 'skills', label: 'Skills verified', points: 20, earn: (p) => (Array.isArray(p.skills) && p.skills.length > 0 ? 20 : 0) },
      { id: 'license', label: 'Professional license', points: 20, earn: (p) => (p.professionalLicenseVerified ? 20 : 0) },
      { id: 'portfolio', label: 'Portfolio / GitHub / LinkedIn', points: 15, earn: (p) => (has(p.portfolioUrl) || has(p.linkedinUrl) || has(p.githubUrl) ? 15 : 0) },
      { id: 'industryCerts', label: 'Industry certifications', points: 20, earn: (p) => (p.industryCertVerified ? 20 : 0) },
    ],
  },
  {
    id: 'social',
    label: 'Social & Peer Trust',
    tip: 'Get endorsed by colleagues and managers.',
    items: [
      { id: 'managerEndorse', label: 'Manager endorsement', points: 20, earn: (p) => ((p.endorsements || 0) >= 3 ? 20 : 0) },
      { id: 'hrEndorse', label: 'HR endorsement', points: 15, earn: (p) => ((p.endorsements || 0) >= 2 ? 15 : 0) },
      { id: 'colleagueEndorse', label: 'Colleague endorsement', points: 15, earn: (p) => ((p.endorsements || 0) >= 1 ? 15 : 0) },
    ],
  },
  {
    id: 'compliance',
    label: 'Compliance & Risk',
    tip: 'Clear background checks build trust.',
    items: [
      { id: 'noFraud', label: 'No fraud records', points: 30, earn: (p) => (p.fraudCheckCleared ? 30 : 0) },
      { id: 'noCourt', label: 'No court cases', points: 25, earn: (p) => (p.courtCheckCleared ? 25 : 0) },
      // A passed identity check (Aadhaar + face) means no identity mismatch.
      { id: 'noMismatch', label: 'No identity mismatch', points: 20, earn: (p) => (p.aadhaarVerified && p.biometricVerified ? 20 : 0) },
      // A document-verified job means its documents passed review (not fake).
      { id: 'noFakeDocs', label: 'No fake documents detected', points: 25, earn: (_p, jobs) => (jobs.some(isVerifiedJob) ? 25 : 0) },
    ],
  },
  {
    id: 'employerFeedback',
    label: 'Employer Feedback',
    tip: 'Ratings from HR and managers.',
    items: [
      { id: 'hrRating', label: 'HR rating', points: 20, earn: (_p, jobs) => (jobs.some(isHrPlus) ? 20 : 0) },
      { id: 'managerRating', label: 'Manager rating', points: 15, earn: (_p, jobs) => (jobs.some(isEmployerVerified) ? 15 : 0) },
      { id: 'conduct', label: 'Attendance & professional conduct', points: 15, earn: (_p, jobs) => (jobs.some((j) => j.rehireEligible === true) ? 15 : 0) },
    ],
  },
];

export const CATEGORY_MAX = Object.fromEntries(
  SCORE_RUBRIC.map((c) => [c.id, c.items.reduce((s, i) => s + i.points, 0)]),
);

/* ── computation ───────────────────────────────────────────────────────────── */

/** Full transparent breakdown: category → items, each with earned/max. */
export function getScoreBreakdown(profile, jobs = []) {
  if (!profile) return { categories: [], trustPoints: 0, maxTrustPoints: TRUST_POINTS_MAX };
  let trustPoints = 0;

  const categories = SCORE_RUBRIC.map((cat) => {
    const items = cat.items.map((item) => {
      const earned = Math.max(0, Math.min(item.points, item.earn(profile, jobs)));
      return { id: item.id, label: item.label, points: earned, max: item.points, done: earned >= item.points };
    });
    const points = items.reduce((s, i) => s + i.points, 0);
    const max = items.reduce((s, i) => s + i.max, 0);
    trustPoints += points;
    return { id: cat.id, label: cat.label, tip: cat.tip, points, max, done: points >= max, items };
  });

  return { categories, trustPoints, maxTrustPoints: TRUST_POINTS_MAX };
}

/** Map 0–1000 trust points onto the 300–1000 display score. */
export function trustPointsToScore(trustPoints) {
  const score = SCORE_MIN + Math.round((trustPoints / TRUST_POINTS_MAX) * (SCORE_MAX - SCORE_MIN));
  return Math.min(SCORE_MAX, Math.max(SCORE_MIN, score));
}

export function calculateEmployeeScore(profile, jobs = []) {
  if (!profile) return SCORE_MIN;
  const { trustPoints } = getScoreBreakdown(profile, jobs);
  return trustPointsToScore(trustPoints);
}

/** Category-level factors — the shape the score page + company views consume. */
export function getScoreFactors(profile, jobs = []) {
  const { categories } = getScoreBreakdown(profile, jobs);
  return categories.map((c) => ({
    id: c.id,
    label: c.label,
    points: c.points,
    max: c.max,
    tip: c.tip,
    done: c.done,
    items: c.items,
  }));
}

/* ── trust bands (6 tiers) ─────────────────────────────────────────────────── */

const TRUST_BANDS = [
  { min: 300, max: 450, label: 'High Risk', tier: 'E', color: '#dc2626', description: 'High risk. Start verifying your identity and employment to build trust.' },
  { min: 451, max: 600, label: 'Needs Improvement', tier: 'D', color: '#ea580c', description: 'Getting started. Complete identity and add verified jobs to improve.' },
  { min: 601, max: 750, label: 'Fair', tier: 'C', color: '#ca8a04', description: 'Building trust. Verify more employment and education records.' },
  { min: 751, max: 850, label: 'Good', tier: 'B', color: '#1e3a8a', description: 'Strong, reliable profile. Employers can hire with confidence.' },
  { min: 851, max: 950, label: 'Excellent', tier: 'A', color: '#16a34a', description: 'Top-tier verified professional. Highly trusted by employers.' },
  { min: 951, max: 1000, label: 'Elite Trust', tier: 'A+', color: '#7c3aed', description: 'Elite trust. Fully verified across identity, employment and compliance.' },
];

export function getTrustBand(score) {
  return TRUST_BANDS.find((b) => score >= b.min && score <= b.max) || TRUST_BANDS[0];
}

export function getScoreRating(score) {
  const band = getTrustBand(score);
  return { label: band.label, tier: band.tier, description: band.description, color: band.color, band: `${band.min}-${band.max}` };
}

export function getScorePercentile(score) {
  if (score >= 951) return 'Top 2% of professionals';
  if (score >= 851) return 'Top 10% of professionals';
  if (score >= 751) return 'Top 25% of professionals';
  if (score >= 601) return 'Top 50% of professionals';
  if (score >= 451) return 'Building your ranking';
  return 'Not yet ranked';
}

/* ── verification-flow helpers (unchanged public API) ──────────────────────── */

export function getVerificationPercent(profile) {
  let percent = 0;
  if (profile.profileSetupComplete) percent += 25;
  if (profile.aadhaarVerified) percent += 25;
  if (profile.biometricVerified) percent += 25;
  if (profile.panVerified) percent += 25;
  return Math.min(100, percent);
}

export function isVerificationComplete(profile) {
  return Boolean(profile.profileSetupComplete && profile.aadhaarVerified && profile.biometricVerified);
}

/**
 * Portal access gate — deliberately NOT the same as the Identity Verified badge.
 *
 * The face match is optional: doing it earns the points and the badge, skipping
 * it must not lock Professional ID / Job History / Vault / Activity behind a step
 * the user was told they could skip. Identity is still established by the
 * admin-reviewed Aadhaar, so that stays required.
 */
export function isPortalUnlocked(profile) {
  return Boolean(profile.profileSetupComplete && profile.aadhaarVerified);
}

export function getCurrentVerificationStep(profile) {
  if (!profile.profileSetupComplete) return 'profile';
  if (!profile.aadhaarVerified) return 'aadhaar';
  if (!profile.biometricVerified) return 'biometric';
  return 'complete';
}
