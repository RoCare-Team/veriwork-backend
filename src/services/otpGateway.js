import { env } from '../config/env.js';

/**
 * Phone-OTP delivery and verification through the shared SMS gateway.
 *
 * The gateway owns the code: it generates it, sends the SMS, and is the thing
 * that says whether a submitted code is right. We never see or store it. What
 * otpService adds on top is the part the gateway does not do — throttling, and
 * turning these replies into errors the routes can act on.
 *
 * Configure in .env:
 *   OTP_SEND_URL, OTP_VERIFY_URL, OTP_TOKEN, OTP_SOURCE
 * With OTP_SEND_URL/OTP_VERIFY_URL unset the gateway is off and the OTP flow
 * falls back to the savshka sender (or the dev mock code).
 */

const GATEWAY_TIMEOUT_MS = 15000;

const UNREACHABLE = {
  ok: false,
  message: 'Could not reach the SMS service. Please try again.',
};

/** Whether both gateway endpoints are configured. */
export function gatewayEnabled() {
  return env.otp.gateway.enabled;
}

/** The gateway wants a bare 10-digit Indian mobile, not the stored +91 form. */
export function toGatewayPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** Common request shape for both gateway calls. */
async function callGateway(url, body, withToken) {
  const headers = { 'Content-Type': 'application/json' };
  // Only the send endpoint is authenticated; verify is open, which is why the
  // attempt limit in otpService is ours to enforce rather than inherited.
  if (withToken) headers['X-App-Token'] = env.otp.gateway.token;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
  });

  // The gateway answers 200 with a JSON body even for failures, and sometimes
  // with leading blank lines from the PHP that produced it.
  const text = (await res.text()).trim();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    console.error('[otp-gateway] unparseable reply', res.status, text.slice(0, 200));
    return UNREACHABLE;
  }

  return { ok: data?.error === false, message: data?.msg || '', data };
}

/**
 * Ask the gateway to text a fresh code to this number.
 * @param {string} phone bare 10-digit mobile
 */
export async function requestOtp(phone) {
  try {
    return await callGateway(
      env.otp.gateway.sendUrl,
      {
        phoneNumber: phone,
        // Tells the gateway which site the code is for; it keeps a list of
        // permitted sources and rejects anything not on it.
        source: env.otp.gateway.source,
      },
      true,
    );
  } catch (err) {
    console.error('[otp-gateway] send request failed', err);
    return UNREACHABLE;
  }
}

/**
 * Ask the gateway whether a submitted code is the one it sent.
 * @param {string} phone bare 10-digit mobile
 * @param {string} otp   the code the visitor typed
 */
export async function checkOtp(phone, otp) {
  try {
    return await callGateway(
      env.otp.gateway.verifyUrl,
      { phoneNumber: phone, newOtp: String(otp).trim() },
      false,
    );
  } catch (err) {
    console.error('[otp-gateway] verify request failed', err);
    return UNREACHABLE;
  }
}
