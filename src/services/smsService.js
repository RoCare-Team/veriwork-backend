import { env } from '../config/env.js';

/**
 * SMS delivery via the savshka gateway.
 *
 * The OTP message MUST match the registered DLT template exactly (word for word),
 * otherwise operators drop it. The template text is:
 *   "Dear Customer, Your OTP for <Brand> profile verification is <OTP>. Regards, <Brand>"
 * Only the OTP is variable; the brand comes from SMS_BRAND_NAME.
 */
export function buildOtpMessage(otp) {
  const brand = env.sms.brandName;
  return `Dear Customer, Your OTP for ${brand} profile verification is ${otp}. Regards, ${brand}`;
}

/** Gateway wants a plain digit string (no '+'), e.g. 91XXXXXXXXXX. */
function toGatewayNumber(number) {
  return String(number || '').replace(/\D/g, '');
}

/**
 * Send an OTP SMS. Never throws — returns a delivery result so the OTP flow
 * keeps working (the code is already stored) even if the gateway is down.
 */
export async function sendOtpSms(number, otp) {
  const to = toGatewayNumber(number);
  const body = buildOtpMessage(otp);

  if (!env.sms.enabled) {
    console.log(`[sms:mock] OTP ${otp} → ${to} (SMS_API_KEY not set)`);
    return { sent: false, mock: true };
  }

  const url =
    `${env.sms.apiUrl}?` +
    new URLSearchParams({
      key: env.sms.apiKey,
      from: env.sms.senderId,
      to,
      body,
      entityid: env.sms.entityId,
      templateid: env.sms.otpTemplateId,
    }).toString();

  try {
    const res = await fetch(url, { method: 'GET' });
    const text = await res.text();
    if (!res.ok) {
      console.error(`[sms] gateway HTTP ${res.status} for ${to}: ${text}`);
      return { sent: false, error: `HTTP ${res.status}`, response: text };
    }
    console.log(`[sms] OTP sent to ${to} → ${text}`);
    return { sent: true, response: text };
  } catch (err) {
    console.error(`[sms] failed to send OTP to ${to}: ${err.message}`);
    return { sent: false, error: err.message };
  }
}
