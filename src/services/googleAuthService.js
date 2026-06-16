import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

let client;

function getClient() {
  if (!client) {
    client = new OAuth2Client(env.google.clientId);
  }
  return client;
}

export async function verifyGoogleIdToken(idToken) {
  if (!env.google.clientId) {
    throw ApiError.badRequest('Google login is not configured on the server');
  }

  try {
    const ticket = await getClient().verifyIdToken({
      idToken,
      audience: env.google.clientId,
    });

    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      throw ApiError.unauthorized('Invalid Google token');
    }

    return {
      googleId: payload.sub,
      email: payload.email.toLowerCase(),
      name: payload.name || '',
      picture: payload.picture || null,
      emailVerified: payload.email_verified === true,
    };
  } catch (err) {
    if (err.isOperational) throw err;
    throw ApiError.unauthorized('Invalid or expired Google token');
  }
}
