import crypto from 'crypto';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { encryptSecret, decryptSecret } from '../utils/crypto.js';
import { DigiLockerConnection } from '../models/DigiLockerConnection.js';
import { DigiLockerOAuthState } from '../models/DigiLockerOAuthState.js';

const PROVIDER = 'digilocker';

function hashState(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function requireOAuthConfig({ data = false } = {}) {
  const required = ['clientId', 'clientSecret', 'redirectUri', 'authorizationUrl', 'tokenUrl', 'scopes'];
  if (data) required.push('documentsUrl');
  const missing = required.filter((key) => !env.digilocker[key]);
  if (missing.length) throw ApiError.serviceUnavailable(`DigiLocker is not configured: ${missing.join(', ')}`);
  if (env.nodeEnv === 'production' && !env.digilocker.redirectUri.startsWith('https://')) {
    throw ApiError.serviceUnavailable('DigiLocker production redirect URI must use HTTPS');
  }
}

function safeRedirect(path) {
  return `${env.frontendUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

function providerErrorMessage(error) {
  if (!error) return 'DigiLocker authentication failed';
  const known = {
    access_denied: 'DigiLocker consent was cancelled',
    invalid_request: 'DigiLocker rejected the authentication request',
    unauthorized_client: 'DigiLocker client is not authorised',
  };
  return known[error] || 'DigiLocker authentication failed';
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: env.digilocker.redirectUri,
  });
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  if (env.digilocker.tokenAuthMethod === 'client_secret_basic') {
    headers.Authorization = `Basic ${Buffer.from(`${env.digilocker.clientId}:${env.digilocker.clientSecret}`).toString('base64')}`;
    body.set('client_id', env.digilocker.clientId);
  } else {
    body.set('client_id', env.digilocker.clientId);
    body.set('client_secret', env.digilocker.clientSecret);
  }

  const response = await fetch(env.digilocker.tokenUrl, { method: 'POST', headers, body });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw ApiError.badRequest('DigiLocker authorization could not be completed');
  }
  return payload;
}

async function fetchProviderUserId(accessToken) {
  if (!env.digilocker.userInfoUrl) return null;
  const response = await fetch(env.digilocker.userInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => ({}));
  return payload.sub || payload.user_id || payload.userId || payload.id || null;
}

export async function createAuthorizationUrl(userId) {
  requireOAuthConfig();
  await DigiLockerOAuthState.deleteMany({ userId, usedAt: null });
  const rawState = crypto.randomBytes(32).toString('base64url');
  await DigiLockerOAuthState.create({
    stateHash: hashState(rawState),
    userId,
    scopes: env.digilocker.scopes,
    expiresAt: new Date(Date.now() + env.digilocker.stateTtlSeconds * 1000),
  });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.digilocker.clientId,
    redirect_uri: env.digilocker.redirectUri,
    scope: env.digilocker.scopes,
    state: rawState,
  });
  return { authorizationUrl: `${env.digilocker.authorizationUrl}?${params}` };
}

export async function handleCallback({ code, state, error }) {
  if (error) return { redirect: safeRedirect(env.digilocker.frontendFailurePath), message: providerErrorMessage(error) };
  if (!code || !state || !/^[A-Za-z0-9_-]{32,}$/.test(state)) {
    return { redirect: safeRedirect(env.digilocker.frontendFailurePath), message: 'Invalid DigiLocker callback' };
  }

  const stateRecord = await DigiLockerOAuthState.findOneAndUpdate(
    { stateHash: hashState(state), usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
    { new: true },
  );
  if (!stateRecord) return { redirect: safeRedirect(env.digilocker.frontendFailurePath), message: 'Expired DigiLocker authorization' };

  try {
    requireOAuthConfig();
    const token = await exchangeCode(code);
    const providerUserId = await fetchProviderUserId(token.access_token);
    await DigiLockerConnection.findOneAndUpdate(
      { userId: stateRecord.userId, provider: PROVIDER },
      {
        $set: {
          providerUserId,
          accessTokenEncrypted: encryptSecret(token.access_token),
          refreshTokenEncrypted: encryptSecret(token.refresh_token || ''),
          tokenExpiresAt: token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000) : null,
          scopes: String(token.scope || stateRecord.scopes).split(/\s+/).filter(Boolean),
          status: 'connected',
          updatedAt: new Date(),
        },
        $setOnInsert: { connectedAt: new Date() },
      },
      { upsert: true, new: true },
    );
    return { redirect: safeRedirect(env.digilocker.frontendSuccessPath) };
  } catch (err) {
    await DigiLockerConnection.updateOne({ userId: stateRecord.userId, provider: PROVIDER }, { $set: { status: 'error' } });
    return { redirect: safeRedirect(env.digilocker.frontendFailurePath), message: err.isOperational ? err.message : 'DigiLocker authentication failed' };
  }
}

function publicConnection(connection) {
  if (!connection || connection.status !== 'connected') return { connected: false };
  return {
    connected: true,
    provider: PROVIDER,
    providerUserId: connection.providerUserId,
    scopes: connection.scopes,
    connectedAt: connection.connectedAt,
    updatedAt: connection.updatedAt,
    tokenExpiresAt: connection.tokenExpiresAt,
  };
}

export async function getConnection(userId) {
  return publicConnection(await DigiLockerConnection.findOne({ userId, provider: PROVIDER }));
}

async function refreshConnection(connection) {
  const refreshToken = decryptSecret(connection.refreshTokenEncrypted);
  if (!refreshToken) throw ApiError.unauthorized('DigiLocker connection has expired; reconnect required');
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: env.digilocker.clientId });
  if (env.digilocker.tokenAuthMethod !== 'client_secret_basic') body.set('client_secret', env.digilocker.clientSecret);
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  if (env.digilocker.tokenAuthMethod === 'client_secret_basic') {
    headers.Authorization = `Basic ${Buffer.from(`${env.digilocker.clientId}:${env.digilocker.clientSecret}`).toString('base64')}`;
  }
  const response = await fetch(env.digilocker.tokenUrl, { method: 'POST', headers, body });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw ApiError.unauthorized('DigiLocker connection has expired; reconnect required');
  connection.accessTokenEncrypted = encryptSecret(payload.access_token);
  if (payload.refresh_token) connection.refreshTokenEncrypted = encryptSecret(payload.refresh_token);
  connection.tokenExpiresAt = payload.expires_in ? new Date(Date.now() + Number(payload.expires_in) * 1000) : null;
  connection.status = 'connected';
  await connection.save();
  return payload.access_token;
}

async function getAccessToken(connection) {
  if (connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() <= Date.now() + 30000) return refreshConnection(connection);
  const token = decryptSecret(connection.accessTokenEncrypted);
  if (!token) return refreshConnection(connection);
  return token;
}

export async function getPermittedDocuments(userId) {
  requireOAuthConfig({ data: true });
  const connection = await DigiLockerConnection.findOne({ userId, provider: PROVIDER, status: 'connected' });
  if (!connection) throw ApiError.notFound('DigiLocker is not connected');
  const response = await fetch(env.digilocker.documentsUrl, { headers: { Authorization: `Bearer ${await getAccessToken(connection)}`, Accept: 'application/json' } });
  if (!response.ok) throw ApiError.badRequest('DigiLocker data could not be retrieved');
  return response.json();
}

export async function disconnect(userId) {
  await DigiLockerConnection.deleteOne({ userId, provider: PROVIDER });
  await DigiLockerOAuthState.deleteMany({ userId });
  return { connected: false };
}