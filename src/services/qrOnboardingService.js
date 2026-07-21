import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import { env } from '../config/env.js';
import { Company } from '../models/Company.js';
import { CompanyEmployee } from '../models/CompanyEmployee.js';
import { CompanyEmployeeInvitation } from '../models/CompanyEmployeeInvitation.js';
import { EmployeeProfile } from '../models/EmployeeProfile.js';
import { QrOnboarding } from '../models/QrOnboarding.js';
import { ApiError } from '../utils/ApiError.js';
import { assertValidObjectId } from '../utils/objectId.js';
import { generateRegistrationToken, sendInvitationNotifications } from './invitationService.js';

function requireCompanyId(user) {
  if (!user?.companyId) throw ApiError.forbidden('No company associated with this account');
  return user.companyId;
}

/** The public page a scanned QR lands on. */
export function buildQrJoinLink(code) {
  return `${env.frontendUrl.replace(/\/$/, '')}/join/${code}`;
}

async function buildQrImage(code) {
  // PNG data URL — rendered straight into an <img>, so the client needs no QR lib.
  return QRCode.toDataURL(buildQrJoinLink(code), {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 512,
    color: { dark: '#1e3a8a', light: '#ffffff' },
  });
}

async function mapQr(qr) {
  return {
    id: qr._id,
    label: qr.label,
    code: qr.code,
    department: qr.department || '',
    designation: qr.designation || '',
    scans: qr.scans || 0,
    joined: qr.joined || 0,
    isActive: qr.isActive,
    joinLink: buildQrJoinLink(qr.code),
    qrImage: await buildQrImage(qr.code),
    createdAt: qr.createdAt,
  };
}

export async function listQrCodes(user) {
  const companyId = requireCompanyId(user);
  const codes = await QrOnboarding.find({ companyId }).sort({ createdAt: -1 });
  return { qrCodes: await Promise.all(codes.map(mapQr)) };
}

export async function createQrCode(user, payload) {
  const companyId = requireCompanyId(user);
  const code = `VWQR-${uuidv4().slice(0, 8).toUpperCase()}`;

  const qr = await QrOnboarding.create({
    companyId,
    label: payload.label,
    department: payload.department?.trim() || '',
    designation: payload.designation?.trim() || '',
    code,
    createdBy: user._id,
  });

  return mapQr(qr);
}

export async function setQrActive(user, qrId, isActive) {
  const companyId = requireCompanyId(user);
  const validId = assertValidObjectId(qrId, 'qr id');

  const qr = await QrOnboarding.findOne({ _id: validId, companyId });
  if (!qr) throw ApiError.notFound('QR code not found');

  qr.isActive = Boolean(isActive);
  await qr.save();
  return mapQr(qr);
}

export async function deleteQrCode(user, qrId) {
  const companyId = requireCompanyId(user);
  const validId = assertValidObjectId(qrId, 'qr id');

  const qr = await QrOnboarding.findOneAndDelete({ _id: validId, companyId });
  if (!qr) throw ApiError.notFound('QR code not found');
  return { id: validId, deleted: true };
}

/* ------------------------------ Public (scanned) ------------------------------ */

async function findActiveQr(code) {
  const qr = await QrOnboarding.findOne({ code: code?.trim() });
  if (!qr) throw ApiError.notFound('This QR code is not valid');
  if (!qr.isActive) throw ApiError.badRequest('This QR code is no longer active');
  return qr;
}

/** Landing payload for the scanned page. Counts the scan. */
export async function getQrJoinInfo(code) {
  const qr = await findActiveQr(code);
  const company = await Company.findById(qr.companyId).select('name industry city');

  qr.scans += 1;
  await qr.save();

  return {
    companyName: company?.name || 'This company',
    companyIndustry: company?.industry || '',
    companyCity: company?.city || '',
    label: qr.label,
    department: qr.department || '',
    designation: qr.designation || '',
  };
}

/**
 * A scanned candidate submits their details.
 *
 * This mirrors the Invite Employee flow exactly, just initiated from the other
 * side: already on PagerLook -> a company invitation lands in their portal to
 * accept; not registered -> they get a registration link that auto-joins them to
 * the company once their profile is set up.
 */
export async function submitQrJoinRequest(code, payload) {
  const qr = await findActiveQr(code);
  const companyId = qr.companyId;

  const phone = payload.phone?.trim() || '';
  const email = payload.email?.trim().toLowerCase() || '';

  const orFilter = [];
  if (phone) orFilter.push({ phone });
  if (email) orFilter.push({ email });

  const profile = orFilter.length ? await EmployeeProfile.findOne({ $or: orFilter }) : null;
  const employeeId = profile?.userId || null;
  const isRegistered = Boolean(employeeId);

  if (isRegistered) {
    const alreadyLinked = await CompanyEmployee.findOne({
      companyId,
      employeeId,
      employmentStatus: 'active',
    });
    if (alreadyLinked) {
      throw ApiError.conflict('You are already part of this company on PagerLook');
    }
  }

  const dedupe = [
    ...(email ? [{ employeeEmail: email }] : []),
    ...(phone ? [{ employeeMobile: phone }] : []),
    ...(employeeId ? [{ employeeId }] : []),
  ];
  if (dedupe.length) {
    const existing = await CompanyEmployeeInvitation.findOne({
      companyId,
      status: { $in: ['pending', 'pending_registration'] },
      $or: dedupe,
    });
    if (existing) {
      throw ApiError.conflict('You already have a pending request with this company');
    }
  }

  const registrationToken = isRegistered ? null : generateRegistrationToken();
  const invitation = await CompanyEmployeeInvitation.create({
    companyId,
    employeeId,
    employeeName: profile?.name || payload.name.trim(),
    employeeEmail: email,
    employeeMobile: phone,
    employeeVeriworkId: profile?.veriworkId || '',
    department: payload.department?.trim() || qr.department || '',
    designation: payload.role?.trim() || qr.designation || '',
    status: isRegistered ? 'pending' : 'pending_registration',
    invitedBy: qr.createdBy || null,
    invitedAt: new Date(),
    registrationToken,
    registrationTokenExpiresAt: registrationToken
      ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      : null,
    autoJoinOnSetup: !isRegistered,
    source: 'qr',
  });

  const company = await Company.findById(companyId).select('name');
  const notification = await sendInvitationNotifications({
    invitation,
    companyName: company?.name || 'Company',
    employeeName: invitation.employeeName,
    isRegistered,
  });

  if (notification.emailSent) {
    invitation.emailSentAt = new Date();
    await invitation.save();
  }

  qr.joined += 1;
  await qr.save();

  return {
    submitted: true,
    isRegistered,
    companyName: company?.name || 'the company',
    // Unregistered candidates are redirected straight onto this link — the email
    // (if we had one) is only a backup copy.
    joinLink: isRegistered ? null : notification.joinLink,
    emailSent: Boolean(email) && notification.emailSent,
    message: isRegistered
      ? `Done! ${company?.name || 'The company'} sent an invitation to your PagerLook portal — open Invitations to accept it.`
      : `Taking you to your profile setup — you'll join ${company?.name || 'the company'} automatically once it's done.`,
  };
}
