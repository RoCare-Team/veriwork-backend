import crypto from 'crypto';
import { env } from '../config/env.js';

// AES-256-GCM at-rest encryption for sensitive secrets (e.g. company SMTP passwords).
// Encrypted payload format: v1:<iv-b64>:<authTag-b64>:<cipher-b64>
const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';

let cachedKey = null;

function getKey() {
  if (cachedKey) return cachedKey;
  // Derive a stable 32-byte key from the configured secret. scrypt with a fixed
  // salt keeps derivation deterministic so previously encrypted values stay readable.
  cachedKey = crypto.scryptSync(env.encryptionKey, 'veriwork-smtp-secret', 32);
  return cachedKey;
}

export function encryptSecret(plain) {
  if (plain === undefined || plain === null || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

export function decryptSecret(payload) {
  if (!payload) return '';
  const parts = String(payload).split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    // Not an encrypted payload we recognise — return empty rather than leaking raw data.
    return '';
  }
  try {
    const [, ivB64, tagB64, dataB64] = parts;
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return '';
  }
}

export function isEncrypted(payload) {
  return typeof payload === 'string' && payload.startsWith(`${VERSION}:`);
}
