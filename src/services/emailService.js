import { env } from '../config/env.js';

let transporterPromise = null;

async function getTransporter() {
  if (!env.email.enabled) return null;
  if (!transporterPromise) {
    transporterPromise = (async () => {
      try {
        const nodemailer = await import('nodemailer');
        return nodemailer.default.createTransport({
          host: env.email.smtpHost,
          port: env.email.smtpPort,
          secure: env.email.smtpSecure,
          auth: {
            user: env.email.smtpUser,
            pass: env.email.smtpPass,
          },
        });
      } catch {
        console.warn('[email] nodemailer not available — using mock mode. Run: npm install nodemailer');
        return null;
      }
    })();
  }
  return transporterPromise;
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
  employeeName,
  previousCompanyName,
  designation,
  duration,
  verificationLink,
  isPlatformCompany,
}) {
  const subject = `Employment verification request — ${employeeName} at ${previousCompanyName}`;
  const html = isPlatformCompany
    ? `
      <p>Hello,</p>
      <p>A verification request for <strong>${employeeName}</strong> (${designation || 'Employee'}) at <strong>${previousCompanyName}</strong> is available on your PagerLook company dashboard.</p>
      <p>Please log in to review and respond.</p>
    `
    : `
      <p>Hello,</p>
      <p>Please verify whether <strong>${employeeName}</strong> worked at <strong>${previousCompanyName}</strong>${designation ? ` as <strong>${designation}</strong>` : ''}${duration ? ` (${duration})` : ''}.</p>
      <p><a href="${verificationLink}">Open secure verification form</a></p>
      <p>This link expires in 14 days.</p>
    `;

  const text = isPlatformCompany
    ? `Verification request for ${employeeName} at ${previousCompanyName} — check your PagerLook dashboard.`
    : `Verify ${employeeName} at ${previousCompanyName}: ${verificationLink}`;

  const transport = await getTransporter();
  if (!transport) {
    console.log('[email:mock] Employment verification');
    console.log(`  To: ${to}`);
    console.log(`  Subject: ${subject}`);
    if (verificationLink) console.log(`  Link: ${verificationLink}`);
    return { sent: false, mock: true };
  }

  await transport.sendMail({ from: env.email.from, to, subject, text, html });
  return { sent: true, mock: false };
}
