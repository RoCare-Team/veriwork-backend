import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../config/env.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { ApiError } from '../utils/ApiError.js';

function parseExpiry(expiresIn) {
  const match = String(expiresIn).match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const value = Number(match[1]);
  const unit = match[2];
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return value * multipliers[unit];
}

export function signAccessToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role, companyId: user.companyId?.toString() },
    env.jwt.accessSecret,
    { expiresIn: env.jwt.accessExpiresIn },
  );
}

export async function createRefreshToken(userId) {
  const token = uuidv4();
  const expiresAt = new Date(Date.now() + parseExpiry(env.jwt.refreshExpiresIn));

  await RefreshToken.create({
    userId,
    token,
    expiresAt,
  });

  return token;
}

export async function rotateRefreshToken(oldToken) {
  const stored = await RefreshToken.findOne({ token: oldToken, revokedAt: null });
  if (!stored || stored.expiresAt < new Date()) {
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }

  stored.revokedAt = new Date();
  await stored.save();

  return createRefreshToken(stored.userId);
}

export async function revokeRefreshToken(token) {
  await RefreshToken.updateOne(
    { token, revokedAt: null },
    { revokedAt: new Date() },
  );
}

export async function revokeAllUserTokens(userId) {
  await RefreshToken.updateMany(
    { userId, revokedAt: null },
    { revokedAt: new Date() },
  );
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.jwt.accessSecret);
  } catch {
    throw ApiError.unauthorized('Invalid or expired access token');
  }
}
