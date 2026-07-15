import { env } from '../config/env.js';

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
    html: '<p>This is a test email confirming your <strong>PagerLook</strong> SMTP settings are working.</p>',
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

  const html = isRegistered
    ? `
      <p>Hi ${employeeName || 'there'},</p>
      <p><strong>${companyName}</strong> has invited you to join <strong>${department}</strong> as <strong>${designation}</strong> on PagerLook.</p>
      <p>Log in to your PagerLook employee portal and accept the invitation from your dashboard.</p>
      <p><a href="${joinLink}">Open PagerLook</a></p>
    `
    : `
      <p>Hi ${employeeName || 'there'},</p>
      <p><strong>${companyName}</strong> has invited you to join <strong>${department}</strong> as <strong>${designation}</strong> on PagerLook.</p>
      <p>Click the link below to register and complete your profile. You will be added to the company team automatically after setup.</p>
      <p><a href="${joinLink}">Register & Join Team</a></p>
      <p>This link expires in 14 days.</p>
    `;

  const text = isRegistered
    ? `${companyName} invited you to ${department} as ${designation}. Log in to PagerLook to accept: ${joinLink}`
    : `${companyName} invited you to join on PagerLook. Register here: ${joinLink}`;

  const transport = await getTransporter();
  if (!transport) {
    console.log('[email:mock] Employee invitation');
    console.log(`  To: ${to}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Join link: ${joinLink}`);
    return { sent: false, mock: true, joinLink };
  }

  await transport.sendMail({
    from: env.email.from,
    to,
    subject,
    text,
    html,
  });

  return { sent: true, mock: false, joinLink };
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

  const html = `
    <p>Hi ${employeeName || 'there'},</p>
    <p>${bodyMessage}</p>
    <p>Please review and approve or reject this request in your PagerLook employee portal.</p>
    <p><a href="${reviewLink}">Review access request</a></p>
  `;

  const text = `${bodyMessage} Review: ${reviewLink}`;

  const transport = await getTransporter();
  if (!transport) {
    console.log('[email:mock] Access request');
    console.log(`  To: ${to}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Review link: ${reviewLink}`);
    return { sent: false, mock: true };
  }

  await transport.sendMail({ from: env.email.from, to, subject, text, html });
  return { sent: true, mock: false };
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
  const roleLine = `${designation ? ` (<strong>${designation}</strong>)` : ''}${duration ? ` — ${duration}` : ''}`;
  const greeting = hrName ? `Hi ${hrName},` : 'Hello,';

  // Who is asking? The employee (verifying their own profile) or a hiring company.
  const requestLine = isSelfInitiated
    ? `<strong>${employeeName}</strong> is building their verified professional profile on PagerLook and has requested you, as their previous employer, to confirm their employment${roleLine} at <strong>${previousCompanyName}</strong>.`
    : `<strong>${requestingCompanyName || 'A company on PagerLook'}</strong> has requested employment verification for <strong>${employeeName}</strong>${roleLine} at <strong>${previousCompanyName}</strong>.`;

  const subject = isSelfInitiated
    ? `${employeeName} requested you to verify their employment at ${previousCompanyName}`
    : `Employment verification request — ${employeeName} at ${previousCompanyName}`;

  const html = isPlatformCompany
    ? `
      <p>${greeting}</p>
      <p>A verification request for <strong>${employeeName}</strong> (${designation || 'Employee'}) at <strong>${previousCompanyName}</strong> is available on your PagerLook company dashboard.</p>
      <p>Please log in to review and respond.</p>
    `
    : `
      <p>${greeting}</p>
      <p>${requestLine}</p>
      <p>Please open the secure verification form below to review the details and complete the verification. No login is required.</p>
      <p><a href="${verificationLink}" style="display:inline-block;padding:10px 18px;background:#1a3a8f;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">Open secure verification form</a></p>
      <p style="color:#64748b;font-size:13px;">Or paste this link into your browser:<br/>${verificationLink}</p>
      <p style="color:#64748b;font-size:13px;">This link expires in 14 days.</p>
    `;

  const text = isPlatformCompany
    ? `Verification request for ${employeeName} at ${previousCompanyName} — check your PagerLook dashboard.`
    : isSelfInitiated
      ? `${employeeName} is verifying their profile on PagerLook and requests you to confirm their employment at ${previousCompanyName}. Open the secure form: ${verificationLink}`
      : `${requestingCompanyName || 'A company on PagerLook'} requested employment verification for ${employeeName} at ${previousCompanyName}. Open the secure form: ${verificationLink}`;

  const { transport, from } = await resolveTransport(companySmtp);
  if (!transport) {
    console.log('[email:mock] Employment verification');
    console.log(`  To: ${to}`);
    console.log(`  Subject: ${subject}`);
    if (verificationLink) console.log(`  Link: ${verificationLink}`);
    return { sent: false, mock: true };
  }

  try {
    await transport.sendMail({ from, to, subject, text, html });
    return { sent: true, mock: false };
  } catch (err) {
    console.error(`[email] Failed to send verification email to ${to}:`, err.message);
    return { sent: false, mock: false, error: err.message };
  }
}
