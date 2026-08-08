import crypto from 'crypto';
import { OtpSession } from '../models/OtpSession.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { normalizePhone } from '../utils/idGenerators.js';
import { sendOtpSms } from './smsService.js';

/** Random 6-digit code (100000–999999) for real sends; fixed mock in dev. */
function generateOtpCode() {
  return String(crypto.randomInt(100000, 1000000));
}

export async function sendOtp(phone) {
  const normalized = normalizePhone(phone);
  // Real random code when SMS is live; predictable mock code for local dev.
  const code = env.sms.enabled ? generateOtpCode() : env.otp.mockCode;
  const expiresAt = new Date(Date.now() + env.otp.expiresMinutes * 60 * 1000);

  await OtpSession.deleteMany({ phone: normalized });
  await OtpSession.create({ phone: normalized, code, expiresAt });

  if (env.sms.enabled) {
    const delivery = await sendOtpSms(normalized, code);
    if (!delivery.sent) {
      // Storing succeeded but the gateway didn't accept it — surface a clear
      // error instead of silently telling the user to check their phone.
      throw ApiError.serviceUnavailable('Could not send OTP right now. Please try again.');
    }
  }

  return {
    phone: normalized,
    // Never leak the code in production; dev mock echoes it for convenience.
    message: env.sms.enabled
      ? 'OTP sent to your phone'
      : `OTP sent (dev mock: ${code})`,
    expiresInMinutes: env.otp.expiresMinutes,
  };
}

export async function verifyOtp(phone, code) {
  const normalized = normalizePhone(phone);
  const session = await OtpSession.findOne({ phone: normalized }).sort({ createdAt: -1 });

  if (!session) {
    throw ApiError.badRequest('No OTP session found. Request a new OTP.');
  }
  if (session.expiresAt < new Date()) {
    throw ApiError.badRequest('OTP expired. Request a new OTP.');
  }
  if (session.code !== code) {
    throw ApiError.badRequest('Invalid OTP code.');
  }

  session.verified = true;
  await session.save();

  return normalized;
}
