/**
 * Company-scoped role permissions.
 *
 * Every company user authenticates with role `enterprise_admin` (portal access);
 * what they can actually see/do inside the portal is decided by `user.companyRole`.
 *
 * Levels are ordered: none < view < manage. A route asking for `view` is satisfied
 * by `manage`, so guards only ever state the minimum they need.
 */

export const COMPANY_ROLES = ['owner', 'admin', 'hr_manager', 'recruiter', 'viewer'];

export const COMPANY_ROLE_LABELS = {
  owner: 'Owner',
  admin: 'Admin',
  hr_manager: 'HR Manager',
  recruiter: 'Recruiter',
  viewer: 'Viewer',
};

export const COMPANY_ROLE_DESCRIPTIONS = {
  owner: 'Full access, including company users and settings. Cannot be removed.',
  admin: 'Full access, including inviting and managing company users.',
  hr_manager: 'Manages people, verification and onboarding. No user management.',
  recruiter: 'Handles join requests and onboarding. Read-only elsewhere.',
  viewer: 'Read-only access to people and verification.',
};

export const MODULES = [
  'dashboard',
  'team',
  'workforce',
  'join_requests',
  'access_requests',
  'verification',
  'qr_onboarding',
  'company_users',
  'settings',
];

export const MODULE_LABELS = {
  dashboard: 'Dashboard',
  team: 'Team Management',
  workforce: 'Workforce',
  join_requests: 'Join Requests',
  access_requests: 'Access Requests',
  verification: 'Verification',
  qr_onboarding: 'QR & Onboarding',
  company_users: 'Company Users',
  settings: 'Settings',
};

const LEVEL_RANK = { none: 0, view: 1, manage: 2 };

const M = 'manage';
const V = 'view';
const N = 'none';

/** role -> module -> level */
export const ROLE_PERMISSIONS = {
  owner: {
    dashboard: M,
    team: M,
    workforce: M,
    join_requests: M,
    access_requests: M,
    verification: M,
    qr_onboarding: M,
    company_users: M,
    settings: M,
  },
  admin: {
    dashboard: M,
    team: M,
    workforce: M,
    join_requests: M,
    access_requests: M,
    verification: M,
    qr_onboarding: M,
    company_users: M,
    settings: M,
  },
  hr_manager: {
    dashboard: V,
    team: M,
    workforce: M,
    join_requests: M,
    access_requests: M,
    verification: M,
    qr_onboarding: M,
    company_users: N,
    settings: V,
  },
  recruiter: {
    dashboard: V,
    team: V,
    workforce: V,
    join_requests: M,
    access_requests: V,
    verification: V,
    qr_onboarding: M,
    company_users: N,
    settings: N,
  },
  viewer: {
    dashboard: V,
    team: V,
    workforce: V,
    join_requests: V,
    access_requests: V,
    verification: V,
    qr_onboarding: N,
    company_users: N,
    settings: N,
  },
};

export function normalizeCompanyRole(companyRole) {
  return COMPANY_ROLES.includes(companyRole) ? companyRole : 'viewer';
}

/**
 * The company role to enforce for a user. Accounts created before roles existed
 * (i.e. the admin who registered the company) have no companyRole — they are the owner.
 */
export function effectiveCompanyRole(user) {
  if (!user) return null;
  if (user.companyRole) return user.companyRole;
  return user.role === 'enterprise_admin' ? 'owner' : null;
}

/** Full module -> level map for a role. */
export function getPermissionsForRole(companyRole) {
  const role = normalizeCompanyRole(companyRole);
  return { ...ROLE_PERMISSIONS[role] };
}

export function getModuleLevel(companyRole, module) {
  const perms = ROLE_PERMISSIONS[normalizeCompanyRole(companyRole)] || {};
  return perms[module] || 'none';
}

/** True when the role's level for `module` meets or exceeds `required`. */
export function hasPermission(companyRole, module, required = 'view') {
  const actual = getModuleLevel(companyRole, module);
  return (LEVEL_RANK[actual] || 0) >= (LEVEL_RANK[required] || 0);
}

/** Roles a user is allowed to assign to others. Only owner can create another owner. */
export function assignableRoles(companyRole) {
  const role = normalizeCompanyRole(companyRole);
  if (role === 'owner') return ['admin', 'hr_manager', 'recruiter', 'viewer', 'owner'];
  if (role === 'admin') return ['hr_manager', 'recruiter', 'viewer', 'admin'];
  return [];
}

export function describeRoles() {
  return COMPANY_ROLES.map((role) => ({
    id: role,
    label: COMPANY_ROLE_LABELS[role],
    description: COMPANY_ROLE_DESCRIPTIONS[role],
    permissions: getPermissionsForRole(role),
  }));
}
