import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { Company } from '../models/Company.js';
import { CompanyRole } from '../models/CompanyRole.js';
import { CompanyUserInvite } from '../models/CompanyUserInvite.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { assertValidObjectId } from '../utils/objectId.js';
import {
  COMPANY_ROLE_LABELS,
  COMPANY_ROLES,
  describeRoles,
  effectiveCompanyRole,
} from '../utils/permissions.js';
import { resolveUserPermissions } from './rolePermissionService.js';
import { sendCompanyUserInviteEmail } from './emailService.js';
import { getDecryptedSmtpConfig } from './smtpSettingsService.js';

const INVITE_EXPIRY_DAYS = 7;
const SALT_ROUNDS = 10;

function requireCompanyId(user) {
  if (!user?.companyId) throw ApiError.forbidden('No company associated with this account');
  return user.companyId;
}

function buildInviteLink(token) {
  return `${env.frontendUrl.replace(/\/$/, '')}/enterprise/accept-invite?token=${token}`;
}

function mapCompanyUser(user, currentUserId, customRoleMap = new Map()) {
  const custom = user.companyRoleId ? customRoleMap.get(String(user.companyRoleId)) : null;
  const preset = custom ? null : effectiveCompanyRole(user);

  return {
    id: user._id,
    email: user.email,
    companyRole: preset,
    companyRoleId: custom ? String(user.companyRoleId) : null,
    roleKey: custom ? String(user.companyRoleId) : preset,
    roleLabel: custom ? custom.name : COMPANY_ROLE_LABELS[preset] || preset,
    isCustomRole: Boolean(custom),
    isOwner: preset === 'owner',
    isActive: user.isActive,
    isYou: currentUserId ? String(user._id) === String(currentUserId) : false,
    createdAt: user.createdAt,
  };
}

function mapInvite(invite, customRoleMap = new Map()) {
  const custom = invite.companyRoleId ? customRoleMap.get(String(invite.companyRoleId)) : null;
  return {
    id: invite._id,
    email: invite.email,
    name: invite.name || '',
    roleKey: custom ? String(invite.companyRoleId) : invite.companyRole,
    roleLabel: custom ? custom.name : COMPANY_ROLE_LABELS[invite.companyRole] || invite.companyRole,
    status: invite.status,
    emailStatus: invite.emailStatus,
    invitedAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    inviteLink: buildInviteLink(invite.token),
  };
}

/**
 * Which roles this actor may hand out.
 * Gated on the ability to manage company users; only an owner can mint another owner.
 */
async function getAssignableRoles(actor) {
  const { permissions } = await resolveUserPermissions(actor);
  if (permissions.company_users !== 'manage') return { presets: [], customIds: [] };

  const isOwner = effectiveCompanyRole(actor) === 'owner';
  const presets = COMPANY_ROLES.filter((r) => (r === 'owner' ? isOwner : true));
  const customs = await CompanyRole.find({ companyId: actor.companyId }).select('_id');

  return { presets, customIds: customs.map((c) => String(c._id)) };
}

/**
 * Validate a requested role and return the fields to persist. Callers pass either
 * a preset key (`companyRole`) or a custom role id (`companyRoleId`).
 */
async function resolveAssignment(actor, payload) {
  const { presets, customIds } = await getAssignableRoles(actor);
  if (!presets.length && !customIds.length) {
    throw ApiError.forbidden('You do not have permission to assign roles');
  }

  if (payload.companyRoleId) {
    const id = String(payload.companyRoleId);
    if (!customIds.includes(id)) throw ApiError.badRequest('Selected role not found');
    return { companyRole: null, companyRoleId: id };
  }

  const preset = payload.companyRole;
  if (!preset) throw ApiError.badRequest('A role is required');
  if (!presets.includes(preset)) {
    throw ApiError.forbidden(`You cannot assign the ${COMPANY_ROLE_LABELS[preset] || preset} role`);
  }
  return { companyRole: preset, companyRoleId: null };
}

async function getCustomRoleMap(companyId) {
  const roles = await CompanyRole.find({ companyId }).select('name');
  return new Map(roles.map((r) => [String(r._id), r]));
}

/** Current user's own role + resolved permissions — drives frontend gating. */
export async function getMyPermissions(user) {
  const resolved = await resolveUserPermissions(user);
  const { presets, customIds } = await getAssignableRoles(user);

  return {
    companyRole: resolved.roleKey,
    roleLabel: resolved.roleLabel,
    isCustomRole: resolved.isCustom,
    permissions: resolved.permissions,
    assignableRoles: presets,
    assignableCustomRoleIds: customIds,
  };
}

export function listRoleDefinitions() {
  return describeRoles();
}

export async function listCompanyUsers(user) {
  const companyId = requireCompanyId(user);

  const [users, invites, customRoleMap, assignable] = await Promise.all([
    User.find({ companyId, role: 'enterprise_admin', isActive: true }).sort({ createdAt: 1 }),
    CompanyUserInvite.find({ companyId, status: 'pending' }).sort({ createdAt: -1 }),
    getCustomRoleMap(companyId),
    getAssignableRoles(user),
  ]);

  return {
    users: users.map((u) => mapCompanyUser(u, user._id, customRoleMap)),
    pendingInvites: invites.map((i) => mapInvite(i, customRoleMap)),
    assignableRoles: assignable.presets,
  };
}

/**
 * Create a staff account outright: the admin sets the password and hands over the
 * credentials. Used when you don't want to depend on invite email delivery.
 */
export async function createCompanyUser(actor, payload) {
  const companyId = requireCompanyId(actor);
  const assignment = await resolveAssignment(actor, payload);

  const email = payload.email.trim().toLowerCase();
  const existing = await User.findOne({ email });
  if (existing) {
    throw ApiError.conflict('A user with this email already exists on PagerLook');
  }

  const passwordHash = await bcrypt.hash(payload.password, SALT_ROUNDS);
  const user = await User.create({
    email,
    passwordHash,
    role: 'enterprise_admin',
    companyRole: assignment.companyRole,
    companyRoleId: assignment.companyRoleId,
    companyId,
  });

  // Any pending invite for this address is now moot.
  await CompanyUserInvite.updateMany(
    { companyId, email, status: 'pending' },
    { $set: { status: 'accepted', acceptedAt: new Date() } },
  );

  const customRoleMap = await getCustomRoleMap(companyId);
  return {
    ...mapCompanyUser(user, actor._id, customRoleMap),
    message: `Account created. Share the email and password with them — they can sign in now.`,
  };
}

export async function inviteCompanyUser(actor, payload) {
  const companyId = requireCompanyId(actor);
  const assignment = await resolveAssignment(actor, payload);
  const email = payload.email.trim().toLowerCase();

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw ApiError.conflict('A user with this email already exists on PagerLook');
  }

  const existingInvite = await CompanyUserInvite.findOne({ companyId, email, status: 'pending' });
  if (existingInvite) {
    throw ApiError.conflict('A pending invite already exists for this email');
  }

  const token = crypto.randomBytes(32).toString('hex');
  const invite = await CompanyUserInvite.create({
    companyId,
    email,
    name: payload.name?.trim() || '',
    companyRole: assignment.companyRole || 'viewer',
    companyRoleId: assignment.companyRoleId,
    token,
    expiresAt: new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
    invitedBy: actor._id,
  });

  const company = await Company.findById(companyId);
  const customRoleMap = await getCustomRoleMap(companyId);
  const roleLabel = assignment.companyRoleId
    ? customRoleMap.get(assignment.companyRoleId)?.name || 'Team member'
    : COMPANY_ROLE_LABELS[assignment.companyRole];

  const emailResult = await sendCompanyUserInviteEmail({
    to: email,
    inviteeName: invite.name,
    companyName: company?.name || 'your company',
    roleLabel,
    inviteLink: buildInviteLink(token),
    companySmtp: company ? getDecryptedSmtpConfig(company) : null,
  });

  invite.emailStatus = emailResult.sent ? 'sent' : emailResult.mock ? 'mock' : 'failed';
  await invite.save();

  return {
    ...mapInvite(invite, customRoleMap),
    emailSent: emailResult.sent,
    emailMock: emailResult.mock,
    message: emailResult.sent
      ? `Invite sent to ${email}`
      : 'Invite created — copy the link and share it (email not sent).',
  };
}

export async function revokeCompanyUserInvite(actor, inviteId) {
  const companyId = requireCompanyId(actor);
  const validId = assertValidObjectId(inviteId, 'invite id');

  const invite = await CompanyUserInvite.findOne({ _id: validId, companyId, status: 'pending' });
  if (!invite) throw ApiError.notFound('Pending invite not found');

  invite.status = 'revoked';
  await invite.save();
  return { id: invite._id, status: invite.status };
}

export async function updateCompanyUserRole(actor, userId, payload) {
  const companyId = requireCompanyId(actor);
  const validId = assertValidObjectId(userId, 'user id');

  if (String(actor._id) === String(validId)) {
    throw ApiError.badRequest('You cannot change your own role');
  }

  const assignment = await resolveAssignment(actor, payload);

  const target = await User.findOne({ _id: validId, companyId, role: 'enterprise_admin' });
  if (!target) throw ApiError.notFound('Company user not found');

  if (effectiveCompanyRole(target) === 'owner' && effectiveCompanyRole(actor) !== 'owner') {
    throw ApiError.forbidden('Only an owner can change another owner');
  }

  target.companyRole = assignment.companyRole;
  target.companyRoleId = assignment.companyRoleId;
  await target.save();

  const customRoleMap = await getCustomRoleMap(companyId);
  return mapCompanyUser(target, actor._id, customRoleMap);
}

export async function removeCompanyUser(actor, userId) {
  const companyId = requireCompanyId(actor);
  const validId = assertValidObjectId(userId, 'user id');

  if (String(actor._id) === String(validId)) {
    throw ApiError.badRequest('You cannot remove yourself');
  }

  const target = await User.findOne({ _id: validId, companyId, role: 'enterprise_admin' });
  if (!target) throw ApiError.notFound('Company user not found');

  const targetRole = effectiveCompanyRole(target);
  if (targetRole === 'owner') {
    throw ApiError.forbidden('The company owner cannot be removed');
  }
  if (targetRole === 'admin' && effectiveCompanyRole(actor) !== 'owner') {
    throw ApiError.forbidden('Only an owner can remove an admin');
  }

  target.isActive = false;
  await target.save();

  return { id: target._id, removed: true };
}

/**
 * Admin-set password reset for a staff account — for when someone is locked out
 * and there is no working mailbox to send a reset to.
 */
export async function resetCompanyUserPassword(actor, userId, password) {
  const companyId = requireCompanyId(actor);
  const validId = assertValidObjectId(userId, 'user id');

  const target = await User.findOne({ _id: validId, companyId, role: 'enterprise_admin' });
  if (!target) throw ApiError.notFound('Company user not found');

  if (effectiveCompanyRole(target) === 'owner' && effectiveCompanyRole(actor) !== 'owner') {
    throw ApiError.forbidden('Only an owner can reset an owner password');
  }

  target.passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  await target.save();

  return { id: target._id, message: 'Password updated. Share the new password with them.' };
}

/* ----------------------------- Public: accept invite ----------------------------- */

export async function getCompanyUserInvite(token) {
  if (!token?.trim()) throw ApiError.badRequest('Invite token is required');

  const invite = await CompanyUserInvite.findOne({ token: token.trim() });
  if (!invite) throw ApiError.notFound('Invite not found');

  if (invite.status !== 'pending') {
    throw ApiError.badRequest('This invite has already been used or revoked');
  }
  if (invite.expiresAt <= new Date()) {
    invite.status = 'expired';
    await invite.save();
    throw ApiError.badRequest('This invite has expired');
  }

  const [company, customRole] = await Promise.all([
    Company.findById(invite.companyId).select('name'),
    invite.companyRoleId ? CompanyRole.findById(invite.companyRoleId).select('name') : null,
  ]);

  return {
    email: invite.email,
    name: invite.name || '',
    companyName: company?.name || '',
    roleLabel: customRole?.name || COMPANY_ROLE_LABELS[invite.companyRole] || invite.companyRole,
    expiresAt: invite.expiresAt,
  };
}

export async function acceptCompanyUserInvite(token, password) {
  if (!token?.trim()) throw ApiError.badRequest('Invite token is required');

  const invite = await CompanyUserInvite.findOne({ token: token.trim() });
  if (!invite) throw ApiError.notFound('Invite not found');
  if (invite.status !== 'pending') {
    throw ApiError.badRequest('This invite has already been used or revoked');
  }
  if (invite.expiresAt <= new Date()) {
    invite.status = 'expired';
    await invite.save();
    throw ApiError.badRequest('This invite has expired');
  }

  const existing = await User.findOne({ email: invite.email });
  if (existing) {
    throw ApiError.conflict('An account with this email already exists. Please sign in instead.');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  await User.create({
    email: invite.email,
    passwordHash,
    role: 'enterprise_admin',
    companyRole: invite.companyRoleId ? null : invite.companyRole,
    companyRoleId: invite.companyRoleId || null,
    companyId: invite.companyId,
  });

  invite.status = 'accepted';
  invite.acceptedAt = new Date();
  await invite.save();

  return { message: 'Account created. You can now sign in.', email: invite.email };
}
