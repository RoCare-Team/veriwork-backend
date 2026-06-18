import { ACCESS_TYPES } from './employeeAccessService.js';

export const ACCESS_REQUEST_OPTIONS = [
  {
    value: ACCESS_TYPES.PROFILE,
    label: 'Profile Access',
    description: 'View contact details, skills, and employment history',
  },
  {
    value: ACCESS_TYPES.BACKGROUND,
    label: 'Background Check',
    description: 'View uploaded documents and background records',
  },
  {
    value: ACCESS_TYPES.VERIFICATION,
    label: 'Verification Data',
    description: 'View identity verification status and trust score breakdown',
  },
  {
    value: ACCESS_TYPES.FULL_PROFILE,
    label: 'Get Full Profile Access',
    description: 'Complete access to profile, documents, and verification data',
  },
];

export function listAccessRequestTypes() {
  return ACCESS_REQUEST_OPTIONS;
}
