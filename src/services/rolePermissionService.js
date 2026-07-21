import { CompanyRole } from '../models/CompanyRole.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { assertValidObjectId } from '../utils/objectId.js';
import {
  COMPANY_ROLE_LABELS,
  MODULES,
  MODULE_LABELS,
  describeRoles,
  effectiveCompanyRole,
  getPermissionsForRole,
} from '../utils/permissions.js';

const LEVEL_RANK = { none: 0, view: 1, manage: 2 };

function requireCompanyId(user) {
  if (!user?.companyId) throw ApiError.forbidden('No company associated with this account');
  return user.companyId;
}

function normalizePermissions(input = {}) {
  return MODULES.reduce((acc, module) => {
    const level = input[module];
    acc[module] = ['none', 'view', 'manage'].includes(level) ? level : 'none';
    return acc;
  }, {});
}

function mapCustomRole(role) {
  return {
    id: role._id.toString(),
    key: role._id.toString(),
    label: role.name,
    name: role.name,
    description: role.description || '',
    permissions: normalizePermissions(role.permissions?.toObject?.() || role.permissions || {}),
    isCustom: true,
  };
}

/**
 * The permissions actually in force for a user.
 *
 * A custom role (companyRoleId) wins; otherwise we fall back to the preset key,
 * and accounts predating roles resolve to owner (they created the company).
 * If a custom role was deleted out from under a user they drop to no access
 * rather than silently inheriting someone else's.
 */
export async function resolveUserPermissions(user) {
  if (user?.companyRoleId) {
    const role = await CompanyRole.findOne({ _id: user.companyRoleId, companyId: user.companyId });
    if (role) {
      return {
        roleKey: role._id.toString(),
        roleLabel: role.name,
        isCustom: true,
        permissions: normalizePermissions(role.permissions?.toObject?.() || role.permissions || {}),
      };
    }
    return { roleKey: null, roleLabel: 'No role', isCustom: false, permissions: {} };
  }

  const preset = effectiveCompanyRole(user);
  if (!preset) return { roleKey: null, roleLabel: 'No role', isCustom: false, permissions: {} };

  return {
    roleKey: preset,
    roleLabel: COMPANY_ROLE_LABELS[preset] || preset,
    isCustom: false,
    permissions: getPermissionsForRole(preset),
  };
}

export async function userHasPermission(user, module, level = 'view') {
  const { permissions } = await resolveUserPermissions(user);
  const actual = permissions[module] || 'none';
  return (LEVEL_RANK[actual] || 0) >= (LEVEL_RANK[level] || 0);
}

/** Only someone who can manage company users may hand roles out. */
export async function canManageUsers(user) {
  return userHasPermission(user, 'company_users', 'manage');
}

/* --------------------------------- Roles CRUD --------------------------------- */

export async function listRoles(user) {
  const companyId = requireCompanyId(user);
  const custom = await CompanyRole.find({ companyId }).sort({ createdAt: 1 });

  return {
    modules: MODULES.map((id) => ({ id, label: MODULE_LABELS[id] })),
    presetRoles: describeRoles().map((r) => ({ ...r, key: r.id, isCustom: false })),
    customRoles: custom.map(mapCustomRole),
  };
}

export async function createRole(user, payload) {
  const companyId = requireCompanyId(user);
  const name = payload.name.trim();

  const clash = await CompanyRole.findOne({ companyId, name });
  if (clash) throw ApiError.conflict('A role with this name already exists');

  const role = await CompanyRole.create({
    companyId,
    name,
    description: payload.description?.trim() || '',
    permissions: normalizePermissions(payload.permissions),
    createdBy: user._id,
  });

  return mapCustomRole(role);
}

export async function updateRole(user, roleId, payload) {
  const companyId = requireCompanyId(user);
  const validId = assertValidObjectId(roleId, 'role id');

  const role = await CompanyRole.findOne({ _id: validId, companyId });
  if (!role) throw ApiError.notFound('Role not found');

  if (payload.name && payload.name.trim() !== role.name) {
    const clash = await CompanyRole.findOne({ companyId, name: payload.name.trim() });
    if (clash) throw ApiError.conflict('A role with this name already exists');
    role.name = payload.name.trim();
  }
  if (payload.description !== undefined) role.description = payload.description.trim();
  if (payload.permissions) role.permissions = normalizePermissions(payload.permissions);

  await role.save();
  return mapCustomRole(role);
}

export async function deleteRole(user, roleId) {
  const companyId = requireCompanyId(user);
  const validId = assertValidObjectId(roleId, 'role id');

  const role = await CompanyRole.findOne({ _id: validId, companyId });
  if (!role) throw ApiError.notFound('Role not found');

  // Refuse rather than silently stranding the people on it.
  const inUse = await User.countDocuments({ companyId, companyRoleId: role._id, isActive: true });
  if (inUse > 0) {
    throw ApiError.badRequest(
      `${inUse} user${inUse > 1 ? 's are' : ' is'} still on this role. Move them to another role first.`,
    );
  }

  await role.deleteOne();
  return { id: validId, deleted: true };
}
