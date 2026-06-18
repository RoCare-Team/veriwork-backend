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
