import { OtpSession } from '../models/OtpSession.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { normalizePhone } from '../utils/idGenerators.js';

export async function sendOtp(phone) {
  const normalized = normalizePhone(phone);
  const code = env.otp.mockCode;
  const expiresAt = new Date(Date.now() + env.otp.expiresMinutes * 60 * 1000);

  await OtpSession.deleteMany({ phone: normalized });
  await OtpSession.create({ phone: normalized, code, expiresAt });

  return {
    phone: normalized,
    message: env.isDev
      ? `OTP sent (dev mock: ${code})`
      : 'OTP sent to your phone',
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
