import { DemoRequest } from '../models/DemoRequest.js';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { sendBrandedEmail } from './emailService.js';
import { normalizePhone } from '../utils/idGenerators.js';

/** Leads one email/phone may file per hour — enough for a genuine retry, not a flood. */
const MAX_PER_HOUR = 3;
const WINDOW_MS = 60 * 60 * 1000;

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Where the "new demo request" alert goes. */
function alertRecipient() {
  return env.admin.email || env.email.supportEmail;
}

/**
 * Tell the team a lead came in. Best-effort: a mail outage must not lose the
 * request, which is already saved by the time this runs.
 */
async function notifyAdmin(request) {
  const to = alertRecipient();
  if (!to) return;

  const rows = [
    ['Name', request.name],
    ['Email', request.email],
    ['Phone', request.phone],
    ['Company', request.company || '—'],
    ['Team size', request.teamSize || '—'],
    ['Message', request.message || '—'],
  ]
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#64748b;font-size:13px;">${k}</td>` +
        `<td style="padding:6px 0;color:#0f172a;font-size:13px;font-weight:600;">${escapeHtml(v)}</td></tr>`,
    )
    .join('');

  try {
    await sendBrandedEmail({
      to,
      subject: `New demo request — ${request.company || request.name}`,
      heading: 'New demo request',
      preheader: `${request.name} asked for a PagerLook demo`,
      bodyHtml: `<p>A visitor asked for a demo from the website.</p><table>${rows}</table>`,
      cta: { label: 'Open admin console', url: `${env.frontendUrl}/admin/demo-requests` },
      category: 'Demo request',
    });
  } catch (err) {
    console.error('[demo-request] admin alert failed', err.message);
  }
}

function toPublic(doc) {
  return {
    id: doc._id.toString(),
    name: doc.name,
    email: doc.email,
    phone: doc.phone,
    company: doc.company,
    teamSize: doc.teamSize,
    message: doc.message,
    status: doc.status,
    notes: doc.notes,
    handledBy: doc.handledBy
      ? { id: doc.handledBy._id?.toString?.() || doc.handledBy.toString(), name: doc.handledBy.name, email: doc.handledBy.email }
      : null,
    handledAt: doc.handledAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/** File a demo request from the public site. */
export async function createDemoRequest(payload) {
  const email = String(payload.email).trim().toLowerCase();
  const phone = normalizePhone(payload.phone);

  const recent = await DemoRequest.countDocuments({
    $or: [{ email }, { phone }],
    createdAt: { $gte: new Date(Date.now() - WINDOW_MS) },
  });
  if (recent >= MAX_PER_HOUR) {
    throw ApiError.tooManyRequests(
      'We already have your request — our team will call you shortly.',
    );
  }

  const request = await DemoRequest.create({
    name: payload.name.trim(),
    email,
    phone,
    company: payload.company?.trim() || '',
    teamSize: payload.teamSize?.trim() || '',
    message: payload.message?.trim() || '',
  });

  await notifyAdmin(request);

  return {
    id: request._id.toString(),
    message: 'Thanks! Our team will reach out to you shortly.',
  };
}

/** Admin desk: every lead, newest first. */
export async function listDemoRequests({ status = 'all', q = '' } = {}) {
  const filter = {};
  if (status && status !== 'all') filter.status = status;

  const term = String(q || '').trim();
  if (term) {
    const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { phone: rx }, { company: rx }];
  }

  const requests = await DemoRequest.find(filter)
    .sort({ createdAt: -1 })
    .limit(500)
    .populate('handledBy', 'name email');

  return requests.map(toPublic);
}

/** Admin desk: move a lead along, or leave a note on it. */
export async function updateDemoRequest(adminId, id, { status, notes }) {
  const request = await DemoRequest.findById(id);
  if (!request) throw ApiError.notFound('Demo request not found');

  if (status !== undefined) request.status = status;
  if (notes !== undefined) request.notes = notes;
  request.handledBy = adminId;
  request.handledAt = new Date();

  await request.save();
  await request.populate('handledBy', 'name email');

  return toPublic(request);
}

/** Count of untouched leads — surfaced on the admin dashboard. */
export function countNewDemoRequests() {
  return DemoRequest.countDocuments({ status: 'new' });
}
