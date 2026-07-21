import { Company } from '../models/Company.js';
import { EmployeeProfile } from '../models/EmployeeProfile.js';
import { ApiError } from '../utils/ApiError.js';
import { decryptSecret, encryptSecret } from '../utils/crypto.js';
import { sendSmtpTestEmail } from './emailService.js';

function requireCompanyId(user) {
  if (!user?.companyId) throw ApiError.forbidden('No company associated with this account');
  return user.companyId;
}

/** The official/registered email an owner (company or employee) defaults its sender to. */
function ownerDefaultEmail(owner) {
  return owner?.workEmail || owner?.email || '';
}

function ownerDefaultName(owner) {
  return owner?.name || '';
}

/**
 * Public-facing view of an owner's SMTP settings.
 * Never exposes the stored password — only whether one is configured.
 */
export function mapSmtpSettings(owner) {
  const smtp = owner.smtp || {};
  const defaultEmail = ownerDefaultEmail(owner);
  return {
    host: smtp.host || '',
    port: smtp.port || 587,
    secure: Boolean(smtp.secure),
    username: smtp.username || '',
    senderName: smtp.senderName || ownerDefaultName(owner),
    senderEmail: smtp.senderEmail || defaultEmail,
    hasPassword: Boolean(smtp.passwordEnc),
    configured: Boolean(smtp.configured),
    updatedAt: smtp.updatedAt || null,
    defaultSenderEmail: defaultEmail,
  };
}

/** Apply an update payload onto an owner document's `smtp` subdoc. Mutates + returns owner. */
function applySmtpUpdate(owner, payload) {
  const current = owner.smtp || {};

  const host = (payload.host ?? current.host ?? '').trim();
  const username = (payload.username ?? current.username ?? '').trim();
  const senderEmail = (payload.senderEmail ?? current.senderEmail ?? '').trim() || ownerDefaultEmail(owner);
  const senderName = (payload.senderName ?? current.senderName ?? '').trim() || ownerDefaultName(owner);
  const port = Number(payload.port ?? current.port ?? 587) || 587;
  const secure = payload.secure ?? current.secure ?? false;

  // Password is write-only. A blank/omitted value keeps the existing one.
  let passwordEnc = current.passwordEnc || '';
  if (typeof payload.password === 'string' && payload.password.length > 0) {
    passwordEnc = encryptSecret(payload.password);
  }

  const configured = Boolean(host && username && passwordEnc && senderEmail);

  owner.smtp = {
    host,
    port,
    secure: Boolean(secure),
    username,
    passwordEnc,
    senderName,
    senderEmail,
    configured,
    updatedAt: new Date(),
  };
  return owner;
}

/**
 * Returns a decrypted, ready-to-use SMTP config for an owner (company or employee),
 * or null if not fully configured.
 */
export function getDecryptedSmtpConfig(owner) {
  const smtp = owner?.smtp;
  if (!smtp || !smtp.configured || !smtp.host || !smtp.username || !smtp.passwordEnc) {
    return null;
  }
  // Decrypting can throw if the stored secret was encrypted under a different
  // ENCRYPTION_KEY. Treat that as "no per-company SMTP" so the send falls back
  // to the global account instead of crashing the whole email dispatch.
  let password = null;
  try {
    password = decryptSecret(smtp.passwordEnc);
  } catch {
    password = null;
  }
  if (!password) return null;

  const senderEmail = smtp.senderEmail || ownerDefaultEmail(owner);
  const senderName = smtp.senderName || ownerDefaultName(owner);

  return {
    host: smtp.host,
    port: smtp.port || 587,
    secure: Boolean(smtp.secure),
    username: smtp.username,
    password,
    senderEmail,
    senderName,
    from: senderName ? `${senderName} <${senderEmail}>` : senderEmail,
  };
}

async function runSmtpTest(owner, payload) {
  const config = getDecryptedSmtpConfig(owner);
  if (!config) {
    throw ApiError.badRequest('Save complete SMTP settings (host, username, password, sender email) before sending a test email');
  }
  const to = (payload.to || '').trim() || ownerDefaultEmail(owner);
  if (!to) throw ApiError.badRequest('A recipient email is required for the test');

  try {
    const result = await sendSmtpTestEmail({ config, to });
    return { ...result, to };
  } catch (err) {
    throw ApiError.badRequest(`SMTP test failed: ${err.message}`);
  }
}

/* -------------------------------- Company -------------------------------- */

export async function getCompanySmtpSettings(user) {
  const companyId = requireCompanyId(user);
  const company = await Company.findById(companyId);
  if (!company) throw ApiError.notFound('Company not found');
  return mapSmtpSettings(company);
}

export async function updateCompanySmtpSettings(user, payload) {
  const companyId = requireCompanyId(user);
  const company = await Company.findById(companyId);
  if (!company) throw ApiError.notFound('Company not found');
  applySmtpUpdate(company, payload);
  await company.save();
  return mapSmtpSettings(company);
}

export async function sendCompanySmtpTest(user, payload = {}) {
  const companyId = requireCompanyId(user);
  const company = await Company.findById(companyId);
  if (!company) throw ApiError.notFound('Company not found');
  return runSmtpTest(company, payload);
}

export async function getCompanySmtpConfigById(companyId) {
  if (!companyId) return null;
  const company = await Company.findById(companyId);
  if (!company) return null;
  return getDecryptedSmtpConfig(company);
}

/* -------------------------------- Employee -------------------------------- */

async function requireEmployeeProfile(userId) {
  const profile = await EmployeeProfile.findOne({ userId });
  if (!profile) throw ApiError.notFound('Employee profile not found');
  return profile;
}

export async function getEmployeeSmtpSettings(user) {
  const profile = await requireEmployeeProfile(user._id);
  return mapSmtpSettings(profile);
}

export async function updateEmployeeSmtpSettings(user, payload) {
  const profile = await requireEmployeeProfile(user._id);
  applySmtpUpdate(profile, payload);
  await profile.save();
  return mapSmtpSettings(profile);
}

export async function sendEmployeeSmtpTest(user, payload = {}) {
  const profile = await requireEmployeeProfile(user._id);
  return runSmtpTest(profile, payload);
}

export async function getEmployeeSmtpConfigByUserId(userId) {
  if (!userId) return null;
  const profile = await EmployeeProfile.findOne({ userId });
  if (!profile) return null;
  return getDecryptedSmtpConfig(profile);
}
