import crypto from 'crypto';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { encryptSecret, decryptSecret } from '../utils/crypto.js';
import { DigiLockerConnection } from '../models/DigiLockerConnection.js';
import { DigiLockerOAuthState } from '../models/DigiLockerOAuthState.js';
import { EmployeeProfile } from '../models/EmployeeProfile.js';
import { refreshCachedScore } from './employeeProfileService.js';
import { verifyAadhaarViaDigiLocker } from './digilockerAadhaarService.js';

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

const AADHAAR_PAGE = '/employee/verification/aadhaar';

// The callback returns the user to the page that started the flow.
function resultRedirect(purpose, status) {
  if (purpose === 'settings') {
    return safeRedirect(status === 'success' ? env.digilocker.frontendSuccessPath : env.digilocker.frontendFailurePath);
  }
  return safeRedirect(`${AADHAAR_PAGE}?status=${status}`);
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

// PKCE (RFC 7636, S256) — DigiLocker rejects authorization requests without it.
function createPkcePair() {
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function exchangeCode(code, codeVerifier) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: env.digilocker.redirectUri,
    code_verifier: codeVerifier,
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
    // Log the provider's reason (never the code/verifier) so failures are diagnosable.
    console.error('[digilocker] token exchange failed', response.status, payload.error, payload.error_description);
    throw ApiError.badRequest('DigiLocker authorization could not be completed');
  }
  return payload;
}

// The v2 token response (openid scope) carries the DigiLocker identity both as
// top-level fields and inside id_token. id_token came straight from the token
// endpoint over TLS, so reading its claims without a signature check is fine
// (OIDC Core 3.1.3.7).
function decodeIdToken(idToken) {
  const part = typeof idToken === 'string' ? idToken.split('.')[1] : null;
  if (!part) return {};
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

function identityFromToken(token) {
  const claims = decodeIdToken(token.id_token);
  const pick = (...values) => values.find((v) => typeof v === 'string' && v.trim())?.trim() || '';
  return {
    providerUserId: pick(token.digilockerid, claims.digilockerid, claims.sub) || null,
    identity: {
      name: pick(token.name, claims.name, claims.given_name),
      dob: pick(token.dob, claims.dob, claims.birthdate),
      gender: pick(token.gender, claims.gender),
      eaadhaarLinked: String(token.eaadhaar ?? claims.eaadhaar ?? '').toUpperCase() === 'Y',
    },
  };
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

export async function createAuthorizationUrl(userId, { purpose = 'aadhaar' } = {}) {
  requireOAuthConfig();
  await DigiLockerOAuthState.deleteMany({ userId, usedAt: null });
  const rawState = crypto.randomBytes(32).toString('base64url');
  const pkce = createPkcePair();
  await DigiLockerOAuthState.create({
    stateHash: hashState(rawState),
    userId,
    scopes: env.digilocker.scopes,
    codeVerifierEncrypted: encryptSecret(pkce.verifier),
    purpose: purpose === 'settings' ? 'settings' : 'aadhaar',
    expiresAt: new Date(Date.now() + env.digilocker.stateTtlSeconds * 1000),
  });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.digilocker.clientId,
    redirect_uri: env.digilocker.redirectUri,
    scope: env.digilocker.scopes,
    state: rawState,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
  });
  if (env.digilocker.dlFlow) params.set('dl_flow', env.digilocker.dlFlow);
  return { authorizationUrl: `${env.digilocker.authorizationUrl}?${params}` };
}

export async function handleCallback({ code, state, error }) {
  const validState = typeof state === 'string' && /^[A-Za-z0-9_-]{32,}$/.test(state);
  // Consume the state even on a provider error so we know which page to return to.
  const stateRecord = validState
    ? await DigiLockerOAuthState.findOneAndUpdate(
        { stateHash: hashState(state), usedAt: null, expiresAt: { $gt: new Date() } },
        { $set: { usedAt: new Date() } },
        { new: true },
      )
    : null;
  const purpose = stateRecord?.purpose || 'aadhaar';

  if (error) return { redirect: resultRedirect(purpose, 'failed'), message: providerErrorMessage(error) };
  if (!code || !validState) return { redirect: resultRedirect(purpose, 'failed'), message: 'Invalid DigiLocker callback' };
  if (!stateRecord) {
    return { redirect: resultRedirect(purpose, 'failed'), message: 'DigiLocker session expired. Please start again from PagerLook.' };
  }

  let token;
  let providerUserId;
  try {
    requireOAuthConfig();
    const codeVerifier = decryptSecret(stateRecord.codeVerifierEncrypted);
    if (!codeVerifier) throw ApiError.badRequest('DigiLocker session is invalid; please try again');
    token = await exchangeCode(code, codeVerifier);
    const { providerUserId: tokenUserId, identity } = identityFromToken(token);
    providerUserId = tokenUserId || (await fetchProviderUserId(token.access_token));
    await DigiLockerConnection.findOneAndUpdate(
      { userId: stateRecord.userId, provider: PROVIDER },
      {
        $set: {
          providerUserId,
          identity,
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
    await setDigilockerUsed(stateRecord.userId, true);
  } catch (err) {
    await DigiLockerConnection.updateOne({ userId: stateRecord.userId, provider: PROVIDER }, { $set: { status: 'error' } });
    return { redirect: resultRedirect(purpose, 'failed'), message: err.isOperational ? err.message : 'DigiLocker authentication failed' };
  }

  if (purpose === 'settings') return { redirect: resultRedirect(purpose, 'success') };

  // Aadhaar KYC: pull e-Aadhaar and match it against the profile right away.
  try {
    const result = await verifyAadhaarViaDigiLocker(stateRecord.userId, {
      accessToken: token.access_token,
      digilockerId: providerUserId,
    });
    return result.verified
      ? { redirect: resultRedirect(purpose, 'success') }
      : { redirect: resultRedirect(purpose, 'mismatch'), message: result.message };
  } catch (err) {
    if (!err.isOperational) console.error('[digilocker] aadhaar verification failed', err);
    return { redirect: resultRedirect(purpose, 'failed'), message: err.isOperational ? err.message : 'Aadhaar verification failed' };
  }
}

// Drives the "DigiLocker connected" score item and the flag shown to companies/admins.
async function setDigilockerUsed(userId, used) {
  const result = await EmployeeProfile.updateOne({ userId }, { $set: { digilockerUsed: used } });
  if (result.modifiedCount) await refreshCachedScore(userId);
}

function publicConnection(connection) {
  if (!connection || connection.status !== 'connected') return { connected: false };
  return {
    connected: true,
    provider: PROVIDER,
    providerUserId: connection.providerUserId,
    identity: connection.identity,
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
  await setDigilockerUsed(userId, false);
  return { connected: false };
}