import crypto from 'crypto';
import { OtpSession } from '../models/OtpSession.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { normalizePhone } from '../utils/idGenerators.js';
import { checkOtp, gatewayEnabled, requestOtp, toGatewayPhone } from './otpGateway.js';
import { sendOtpSms } from './smsService.js';

/**
 * Phone-login OTP.
 *
 * Three delivery modes, picked by what is configured:
 *   1. Shared gateway (OTP_SEND_URL + OTP_VERIFY_URL) — it generates, sends and
 *      verifies the code; we never see or store it.
 *   2. savshka sender (SMS_API_KEY) — we generate and store the code ourselves.
 *   3. Dev mock — fixed OTP_MOCK_CODE, no SMS, echoed in the response.
 *
 * What this file adds in every mode is the part no gateway does for us:
 * a resend cooldown, an hourly send cap, and an attempt cap.
 */

const WINDOW_MS = env.otp.windowMs;
const RESEND_MS = env.otp.resendSeconds * 1000;

/** Random code of the configured length, for the modes where we own it. */
function generateOtpCode() {
  const digits = Math.max(4, env.otp.length);
  const min = 10 ** (digits - 1);
  return String(crypto.randomInt(min, min * 10));
}

/** Demo/test numbers get a fixed code and never hit the SMS gateway. */
function isTestPhone(normalized) {
  return env.otp.testPhones.includes(normalized);
}

function secondsUntil(timestamp) {
  return Math.max(1, Math.ceil((timestamp - Date.now()) / 1000));
}

function currentSession(normalized) {
  return OtpSession.findOne({ phone: normalized }).sort({ createdAt: -1 });
}

/**
 * The session (if any) plus whether its hourly window is still live, so a send
 * can be recorded without re-reading.
 */
async function loadState(normalized) {
  const session = await currentSession(normalized);
  const windowStart = session?.windowStartedAt?.getTime() ?? 0;
  return { session, windowLive: Date.now() - windowStart < WINDOW_MS };
}

/** Refuse the send if this number is asking too soon or too often. */
async function assertCanSend(normalized) {
  const session = await currentSession(normalized);
  if (!session) return { session: null, windowLive: false };

  const now = Date.now();
  const lastSent = session.lastSentAt?.getTime() ?? 0;
  if (now - lastSent < RESEND_MS) {
    const retryAfterSeconds = secondsUntil(lastSent + RESEND_MS);
    throw ApiError.tooManyRequests(
      `Please wait ${retryAfterSeconds}s before requesting another OTP.`,
      { retryAfterSeconds },
    );
  }

  const windowStart = session.windowStartedAt?.getTime() ?? 0;
  const windowLive = now - windowStart < WINDOW_MS;
  if (windowLive && session.sendCount >= env.otp.maxPerHour) {
    const retryAfterSeconds = secondsUntil(windowStart + WINDOW_MS);
    throw ApiError.tooManyRequests(
      'Too many OTP requests for this number. Please try again later.',
      { retryAfterSeconds },
    );
  }

  return { session, windowLive };
}

/**
 * Record that a code went out. `code` is null when the gateway owns it.
 * The doc is kept alive past the rate-limit window so the counters mean
 * something — the TTL index cleans it up afterwards.
 */
async function recordSend({ session, windowLive }, normalized, code) {
  const now = new Date();
  const fields = {
    phone: normalized,
    code: code || null,
    codeExpiresAt: code ? new Date(Date.now() + env.otp.expiresMinutes * 60 * 1000) : null,
    expiresAt: new Date(Date.now() + WINDOW_MS + 60 * 1000),
    verified: false,
    attempts: 0,
    lastSentAt: now,
  };

  if (!session) {
    await OtpSession.create({ ...fields, sendCount: 1, windowStartedAt: now });
    return;
  }

  // A lapsed window starts over at one; a live one just counts up.
  const update = windowLive
    ? { $set: fields, $inc: { sendCount: 1 } }
    : { $set: { ...fields, sendCount: 1, windowStartedAt: now } };

  await OtpSession.updateOne({ _id: session._id }, update);
}

/** Count a wrong guess, creating the ledger if the send predates it. */
async function registerFailedAttempt(normalized, session) {
  if (session) {
    await OtpSession.updateOne({ _id: session._id }, { $inc: { attempts: 1 } });
    return;
  }
  await OtpSession.create({
    phone: normalized,
    expiresAt: new Date(Date.now() + WINDOW_MS),
    attempts: 1,
  });
}

export async function sendOtp(phone) {
  const normalized = normalizePhone(phone);
  const testPhone = isTestPhone(normalized);
  // Throttling exists to protect the SMS bill; a demo number costs nothing and
  // an app reviewer retrying a login must never hit a cooldown.
  const state = testPhone ? await loadState(normalized) : await assertCanSend(normalized);

  const response = {
    phone: normalized,
    otpLength: env.otp.length,
    resendInSeconds: env.otp.resendSeconds,
    expiresInMinutes: env.otp.expiresMinutes,
    message: 'OTP sent to your phone',
  };

  // Test numbers accept a fixed code and never cost an SMS.
  if (testPhone) {
    await recordSend(state, normalized, env.otp.testCode);
    return { ...response, otpLength: env.otp.testCode.length };
  }

  // 1. The shared gateway generates and sends its own code.
  if (gatewayEnabled()) {
    const result = await requestOtp(toGatewayPhone(normalized));
    if (!result.ok) {
      // The gateway's own wording ("Invalid source", "Customer does not exist")
      // is for us, not the visitor — log it and answer in our own words.
      console.error(`[otp] gateway refused send for ${normalized}: ${result.message}`);
      throw ApiError.serviceUnavailable('Could not send OTP right now. Please try again.');
    }
    await recordSend(state, normalized, null);
    return response;
  }

  // 2/3. We own the code: savshka sender, or the dev mock.
  const code = env.sms.enabled ? generateOtpCode() : env.otp.mockCode;

  if (env.sms.enabled) {
    const delivery = await sendOtpSms(normalized, code);
    if (!delivery.sent) {
      // Nothing is stored until the gateway accepts it, so a failed send leaves
      // the caller free to retry rather than stuck behind our own cooldown.
      throw ApiError.serviceUnavailable('Could not send OTP right now. Please try again.');
    }
  }

  await recordSend(state, normalized, code);

  return {
    ...response,
    otpLength: code.length,
    // Never leak the code in production; the dev mock echoes it for convenience.
    message: env.sms.enabled ? 'OTP sent to your phone' : `OTP sent (dev mock: ${code})`,
  };
}

export async function verifyOtp(phone, code) {
  const normalized = normalizePhone(phone);
  const submitted = String(code ?? '').trim();

  // Test numbers always accept the fixed code, even if the session lapsed —
  // a demo login must never fail on timing.
  if (isTestPhone(normalized) && submitted === env.otp.testCode) {
    await OtpSession.updateMany(
      { phone: normalized },
      { $set: { verified: true, attempts: 0 } },
    );
    return normalized;
  }

  const session = await currentSession(normalized);

  if (session && session.attempts >= env.otp.maxAttempts) {
    throw ApiError.tooManyRequests('Too many incorrect attempts. Request a new OTP.');
  }

  // Gateway mode: it is the only thing that knows the code, so ask it. Sessions
  // written in this mode never carry a code — a stored one means the code was
  // issued locally and must be checked below.
  if (gatewayEnabled() && !session?.code) {
    const result = await checkOtp(toGatewayPhone(normalized), submitted);
    if (!result.ok) {
      await registerFailedAttempt(normalized, session);
      // Same reasoning as the send path: the gateway's wording is a log line,
      // and a single message for wrong/expired/unknown gives nothing away.
      console.warn(`[otp] gateway rejected code for ${normalized}: ${result.message}`);
      throw ApiError.badRequest('Invalid or expired OTP. Please request a new code.');
    }
    if (session) {
      await OtpSession.updateOne(
        { _id: session._id },
        { $set: { verified: true, attempts: 0 } },
      );
    }
    return normalized;
  }

  // Locally-issued code (savshka sender or dev mock).
  if (!session) {
    throw ApiError.badRequest('No OTP session found. Request a new OTP.');
  }
  if (session.codeExpiresAt && session.codeExpiresAt < new Date()) {
    throw ApiError.badRequest('OTP expired. Request a new OTP.');
  }
  if (session.code !== submitted) {
    await registerFailedAttempt(normalized, session);
    throw ApiError.badRequest('Invalid OTP code.');
  }

  session.verified = true;
  session.attempts = 0;
  await session.save();

  return normalized;
}
