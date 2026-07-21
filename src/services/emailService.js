import { env } from '../config/env.js';

/**
 * Centralized email service.
 *
 * Every module in the app sends mail through this one file, and every send is
 * driven entirely by the SMTP_* environment variables (see .env.example). The
 * app is therefore provider-agnostic: moving from Gmail to Amazon SES, or
 * changing the sender to verification@/support@/noreply@pagerlook.com, is a
 * config change only — no code changes anywhere.
 *
 * Two ways mail goes out:
 *   • Global transport  — from SMTP_* env (the default for all system email).
 *   • Per-company SMTP  — an explicit config passed by the caller (companySmtp),
 *                         used so a company's verification mail comes from them.
 * If neither is usable, we fall back to a safe "mock" mode that logs instead of
 * sending, so flows never break when SMTP is not configured (e.g. local dev).
 */

let transporterPromise = null;

async function loadNodemailer() {
  try {
    const nodemailer = await import('nodemailer');
    return nodemailer.default;
  } catch {
    console.warn('[email] nodemailer not available — using mock mode. Run: npm install nodemailer');
    return null;
  }
}

async function getTransporter() {
  if (!env.email.enabled) return null;
  if (!transporterPromise) {
    transporterPromise = (async () => {
      const nodemailer = await loadNodemailer();
      if (!nodemailer) return null;
      return nodemailer.createTransport({
        host: env.email.smtpHost,
        port: env.email.smtpPort,
        secure: env.email.smtpSecure,
        auth: {
          user: env.email.smtpUser,
          pass: env.email.smtpPass,
        },
      });
    })();
  }
  return transporterPromise;
}

/**
 * Build a one-off transporter from an explicit (per-company) SMTP config.
 * Returns null when the config is incomplete or nodemailer is unavailable.
 */
async function createSmtpTransport(config) {
  if (!config?.host || !config?.username || !config?.password) return null;
  const nodemailer = await loadNodemailer();
  if (!nodemailer) return null;

  const port = Number(config.port) || 587;
  // Reconcile the SSL/TLS mode with the port to avoid the common
  // "wrong version number" error: 465 = implicit TLS, 587/25 = STARTTLS.
  let secure = Boolean(config.secure);
  if (port === 465) secure = true;
  else if (port === 587 || port === 25) secure = false;

  return nodemailer.createTransport({
    host: config.host,
    port,
    secure,
    // Enforce STARTTLS on the submission port so non-secure never means plaintext.
    ...(secure ? {} : { requireTLS: port === 587 }),
    auth: { user: config.username, pass: config.password },
  });
}

/**
 * Resolve which transporter + from-address to use for a given send.
 * Prefers the caller-supplied company SMTP config, then the global env SMTP,
 * then falls back to mock mode.
 */
async function resolveTransport(companySmtp) {
  if (companySmtp) {
    const transport = await createSmtpTransport(companySmtp);
    if (transport) {
      return { transport, from: companySmtp.from || companySmtp.senderEmail || env.email.from };
    }
  }
  const transport = await getTransporter();
  return { transport, from: env.email.from };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Branded HTML template — one shared shell for every email.
 * Uses table layout + inline styles for maximum email-client compatibility.
 * All branding (name, colour, logo, support address) comes from env.
 * ──────────────────────────────────────────────────────────────────────────── */

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Render a full branded HTML email.
 * @param {object} opts
 * @param {string} opts.heading   Big title inside the card.
 * @param {string} [opts.preheader] Hidden inbox-preview line.
 * @param {string} opts.bodyHtml  Inner HTML (already-safe markup) for the body.
 * @param {{label:string,url:string}} [opts.cta] Primary button.
 * @param {string} [opts.footerNote] Small note under the button (e.g. expiry).
 */
function renderEmail({ heading, preheader = '', bodyHtml = '', cta, footerNote = '' }) {
  const { brandName, brandTagline, brandColor, brandLogoUrl, supportEmail } = env.email;
  const year = new Date().getFullYear();

  const logo = brandLogoUrl
    ? `<img src="${brandLogoUrl}" alt="${escapeHtml(brandName)}" height="34" style="display:block;border:0;outline:none;" />`
    : `<span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:.3px;">${escapeHtml(brandName)}</span>`;

  const button = cta?.url
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
        <tr>
          <td style="border-radius:10px;background:${brandColor};">
            <a href="${cta.url}" target="_blank"
               style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">
              ${escapeHtml(cta.label)}
            </a>
          </td>
        </tr>
      </table>`
    : '';

  const note = footerNote
    ? `<p style="margin:16px 0 0;color:#94a3b8;font-size:13px;line-height:1.6;">${footerNote}</p>`
    : '';

  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <span style="display:none!important;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(preheader)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
            <!-- Header -->
            <tr>
              <td style="background:${brandColor};border-radius:16px 16px 0 0;padding:22px 32px;">
                ${logo}
                <div style="margin-top:4px;color:rgba(255,255,255,.7);font-size:12px;font-weight:600;letter-spacing:.4px;">${escapeHtml(brandTagline)}</div>
              </td>
            </tr>
            <!-- Body card -->
            <tr>
              <td style="background:#ffffff;padding:32px;">
                <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0f172a;">${escapeHtml(heading)}</h1>
                <div style="font-size:15px;line-height:1.65;color:#334155;">${bodyHtml}</div>
                ${button}
                ${note}
              </td>
            </tr>
            <!-- Footer -->
            <tr>
              <td style="background:#ffffff;border-radius:0 0 16px 16px;border-top:1px solid #e2e8f0;padding:20px 32px;">
                <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.6;">
                  This is an automated message from ${escapeHtml(brandName)}. Need help? Contact
                  <a href="mailto:${supportEmail}" style="color:${brandColor};text-decoration:none;">${supportEmail}</a>.
                </p>
                <p style="margin:8px 0 0;color:#cbd5e1;font-size:12px;">© ${year} ${escapeHtml(brandName)}. All rights reserved.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Core send — the single choke point all senders go through.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Send one email. Resolves the transport (per-company → env → mock), sends, and
 * never throws: on failure it returns { sent:false, error } so callers can
 * record delivery state without the surrounding flow breaking.
 *
 * @param {object} opts
 * @param {string} opts.to
 * @param {string} opts.subject
 * @param {string} opts.html
 * @param {string} opts.text
 * @param {object|null} [opts.companySmtp] Explicit per-company SMTP config.
 * @param {string} [opts.category] Label used only for mock-mode logging.
 * @param {string[]} [opts.logLinks] Extra links to print in mock mode.
 */
async function sendEmail({ to, subject, html, text, companySmtp = null, category = 'email', logLinks = [] }) {
  const { transport, from } = await resolveTransport(companySmtp);

  if (!transport) {
    console.log(`[email:mock] ${category}`);
    console.log(`  To: ${to}`);
    console.log(`  Subject: ${subject}`);
    for (const link of logLinks) console.log(`  Link: ${link}`);
    return { sent: false, mock: true };
  }

  try {
    const message = { from, to, subject, text, html };
    if (env.email.replyTo) message.replyTo = env.email.replyTo;
    await transport.sendMail(message);
    return { sent: true, mock: false };
  } catch (err) {
    console.error(`[email] Failed to send "${category}" to ${to}:`, err.message);
    return { sent: false, mock: false, error: err.message };
  }
}

/**
 * Generic branded notification — any module can send a one-off transactional
 * email without adding a bespoke function here.
 */
export async function sendBrandedEmail({
  to,
  subject,
  heading,
  bodyHtml,
  text,
  cta = null,
  footerNote = '',
  preheader = '',
  companySmtp = null,
  category = 'notification',
}) {
  const html = renderEmail({ heading: heading || subject, preheader, bodyHtml, cta, footerNote });
  return sendEmail({
    to,
    subject,
    html,
    text: text || `${heading || subject}${cta?.url ? `\n\n${cta.label}: ${cta.url}` : ''}`,
    companySmtp,
    category,
    logLinks: cta?.url ? [cta.url] : [],
  });
}

/**
 * Send a test email using a company's SMTP config to validate the credentials.
 */
export async function sendSmtpTestEmail({ config, to }) {
  const transport = await createSmtpTransport(config);
  if (!transport) {
    return { sent: false, mock: true, reason: 'SMTP not configured or mailer unavailable' };
  }
  await transport.sendMail({
    from: config.from || config.senderEmail,
    to,
    subject: 'PagerLook SMTP test email',
    text: 'This is a test email confirming your PagerLook SMTP settings are working.',
    html: renderEmail({
      heading: 'SMTP settings are working',
      bodyHtml: '<p>This is a test email confirming your PagerLook SMTP settings are configured correctly. You can now send system email from this account.</p>',
    }),
  });
  return { sent: true, mock: false };
}

export async function sendEmployeeInvitationEmail({
  to,
  employeeName,
  companyName,
  department,
  designation,
  joinLink,
  isRegistered,
}) {
  const subject = isRegistered
    ? `${companyName} invited you to join their team on PagerLook`
    : `You're invited to join ${companyName} on PagerLook`;

  const greeting = employeeName ? `Hi ${escapeHtml(employeeName)},` : 'Hi there,';
  const roleLine = `<strong>${escapeHtml(department || 'their team')}</strong>${designation ? ` as <strong>${escapeHtml(designation)}</strong>` : ''}`;

  const bodyHtml = isRegistered
    ? `
      <p>${greeting}</p>
      <p><strong>${escapeHtml(companyName)}</strong> has invited you to join ${roleLine} on PagerLook.</p>
      <p>Log in to your employee portal and accept the invitation from your dashboard.</p>
    `
    : `
      <p>${greeting}</p>
      <p><strong>${escapeHtml(companyName)}</strong> has invited you to join ${roleLine} on PagerLook.</p>
      <p>Register and complete your profile using the button below — you'll be added to the company team automatically after setup.</p>
    `;

  const text = isRegistered
    ? `${companyName} invited you to ${department} as ${designation}. Log in to PagerLook to accept: ${joinLink}`
    : `${companyName} invited you to join on PagerLook. Register here: ${joinLink}`;

  return sendEmail({
    to,
    subject,
    html: renderEmail({
      heading: isRegistered ? 'You have a team invitation' : `Join ${companyName} on PagerLook`,
      preheader: subject,
      bodyHtml,
      cta: { label: isRegistered ? 'Open PagerLook' : 'Register & Join Team', url: joinLink },
      footerNote: isRegistered ? '' : 'This link expires in 14 days.',
    }),
    text,
    category: 'Employee invitation',
    logLinks: [joinLink],
  }).then((r) => ({ ...r, joinLink }));
}

const DOC_LABELS = {
  incorporation: 'Certificate of Incorporation',
  registration: 'Registration Document',
  tax: 'GST Registration Certificate',
  taxCertificate: 'GST Registration Certificate',
  addressProof: 'Proof of Business Address',
  signatoryId: 'Authorized Signatory ID',
  bankLetter: 'Company Bank Letter / Cancelled Cheque',
};

export async function sendOnboardingDocumentRejectedEmail({ to, companyName, documentKey, reason }) {
  const docLabel = DOC_LABELS[documentKey] || documentKey;
  const link = `${env.frontendUrl.replace(/\/$/, '')}/enterprise/pending-approval`;
  const subject = `Action needed — ${docLabel} needs to be re-uploaded`;

  const bodyHtml = `
    <p>Hello,</p>
    <p>While reviewing <strong>${escapeHtml(companyName)}</strong>'s PagerLook registration, our compliance team could not accept one document:</p>
    <p style="padding:12px 16px;background:#fef2f2;border-left:3px solid #dc2626;border-radius:6px;">
      <strong>${escapeHtml(docLabel)}</strong><br/>
      <span style="color:#64748b;">${escapeHtml(reason)}</span>
    </p>
    <p>Your other documents are fine — please re-upload just this one and resubmit.</p>
  `;
  const text = `${docLabel} was not accepted: ${reason}. Re-upload it here: ${link}`;

  return sendEmail({
    to,
    subject,
    html: renderEmail({
      heading: 'One document needs attention',
      preheader: subject,
      bodyHtml,
      cta: { label: 'Re-upload document', url: link },
    }),
    text,
    category: 'Onboarding document rejected',
    logLinks: [link],
  });
}

export async function sendCompanyUserInviteEmail({
  to,
  inviteeName,
  companyName,
  roleLabel,
  inviteLink,
  companySmtp = null,
}) {
  const subject = `You've been invited to ${companyName} on PagerLook`;
  const greeting = inviteeName ? `Hi ${escapeHtml(inviteeName)},` : 'Hello,';
  const bodyHtml = `
    <p>${greeting}</p>
    <p>You have been invited to join <strong>${escapeHtml(companyName)}</strong>'s employer portal on PagerLook as <strong>${escapeHtml(roleLabel)}</strong>.</p>
    <p>Set your password to activate your account.</p>
    <p style="color:#64748b;font-size:13px;">Or paste this link into your browser:<br/>${inviteLink}</p>
  `;
  const text = `${greeting} You've been invited to join ${companyName} on PagerLook as ${roleLabel}. Set your password: ${inviteLink}`;

  return sendEmail({
    to,
    subject,
    html: renderEmail({
      heading: `Join ${companyName}'s portal`,
      preheader: subject,
      bodyHtml,
      cta: { label: 'Accept invite & set password', url: inviteLink },
      footerNote: 'This invite expires in 7 days.',
    }),
    text,
    companySmtp,
    category: 'Company user invite',
    logLinks: [inviteLink],
  });
}

export async function sendAccessRequestEmail({
  to,
  employeeName,
  companyName,
  requestType,
  previousEmployerName,
  message,
  reviewLink,
}) {
  const isFullProfile = requestType === 'full_profile_access';
  const subject = isFullProfile
    ? `${companyName} is requesting access to your PagerLook profile`
    : `${companyName} requested access to your PagerLook data`;

  const bodyMessage = message?.trim()
    || (isFullProfile && previousEmployerName
      ? `${companyName} is requesting access to your employment records, verification history, and documents from ${previousEmployerName}.`
      : `${companyName} requested access to your profile on PagerLook.`);

  const bodyHtml = `
    <p>Hi ${escapeHtml(employeeName || 'there')},</p>
    <p>${escapeHtml(bodyMessage)}</p>
    <p>Please review and approve or reject this request in your PagerLook employee portal.</p>
  `;
  const text = `${bodyMessage} Review: ${reviewLink}`;

  return sendEmail({
    to,
    subject,
    html: renderEmail({
      heading: 'Access request for your review',
      preheader: subject,
      bodyHtml,
      cta: { label: 'Review access request', url: reviewLink },
    }),
    text,
    category: 'Access request',
    logLinks: [reviewLink],
  });
}

export async function sendEmploymentVerificationEmail({
  to,
  hrName,
  employeeName,
  previousCompanyName,
  requestingCompanyName,
  designation,
  duration,
  verificationLink,
  isPlatformCompany,
  initiatedBy = 'company',
  companySmtp = null,
}) {
  const isSelfInitiated = initiatedBy === 'employee';
  const roleLine = `${designation ? ` (<strong>${escapeHtml(designation)}</strong>)` : ''}${duration ? ` — ${escapeHtml(duration)}` : ''}`;
  const greeting = hrName ? `Hi ${escapeHtml(hrName)},` : 'Hello,';

  // Who is asking? The employee (verifying their own profile) or a hiring company.
  const requestLine = isSelfInitiated
    ? `<strong>${escapeHtml(employeeName)}</strong> is building their verified professional profile on PagerLook and has requested you, as their previous employer, to confirm their employment${roleLine} at <strong>${escapeHtml(previousCompanyName)}</strong>.`
    : `<strong>${escapeHtml(requestingCompanyName || 'A company on PagerLook')}</strong> has requested employment verification for <strong>${escapeHtml(employeeName)}</strong>${roleLine} at <strong>${escapeHtml(previousCompanyName)}</strong>.`;

  const subject = isSelfInitiated
    ? `${employeeName} requested you to verify their employment at ${previousCompanyName}`
    : `Employment verification request — ${employeeName} at ${previousCompanyName}`;

  const bodyHtml = isPlatformCompany
    ? `
      <p>${greeting}</p>
      <p>A verification request for <strong>${escapeHtml(employeeName)}</strong> (${escapeHtml(designation || 'Employee')}) at <strong>${escapeHtml(previousCompanyName)}</strong> is available on your PagerLook company dashboard.</p>
      <p>Please log in to review and respond.</p>
    `
    : `
      <p>${greeting}</p>
      <p>${requestLine}</p>
      <p>Please open the secure verification form below to review the details and complete the verification. No login is required.</p>
      <p style="color:#64748b;font-size:13px;">Or paste this link into your browser:<br/>${verificationLink}</p>
    `;

  const text = isPlatformCompany
    ? `Verification request for ${employeeName} at ${previousCompanyName} — check your PagerLook dashboard.`
    : isSelfInitiated
      ? `${employeeName} is verifying their profile on PagerLook and requests you to confirm their employment at ${previousCompanyName}. Open the secure form: ${verificationLink}`
      : `${requestingCompanyName || 'A company on PagerLook'} requested employment verification for ${employeeName} at ${previousCompanyName}. Open the secure form: ${verificationLink}`;

  return sendEmail({
    to,
    subject,
    html: renderEmail({
      heading: 'Employment verification request',
      preheader: subject,
      bodyHtml,
      cta: isPlatformCompany ? null : { label: 'Open secure verification form', url: verificationLink },
      footerNote: isPlatformCompany ? '' : 'This link expires in 14 days.',
    }),
    text,
    companySmtp,
    category: 'Employment verification',
    logLinks: verificationLink ? [verificationLink] : [],
  });
}
