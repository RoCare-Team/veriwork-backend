import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import path from 'path';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

let s3Client;

function getClient() {
  if (!s3Client) {
    s3Client = new S3Client({
      region: env.aws.region,
      credentials: {
        accessKeyId: env.aws.accessKeyId,
        secretAccessKey: env.aws.secretAccessKey,
      },
    });
  }
  return s3Client;
}

function buildKey(folder, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const safeFolder = folder.replace(/[^a-zA-Z0-9/_-]/g, '');
  return `veriwork/${safeFolder}/${unique}${ext}`;
}

export function getS3PublicUrl(key) {
  return `https://${env.aws.bucket}.s3.${env.aws.region}.amazonaws.com/${key}`;
}

export async function uploadFileToS3(file, folder = 'uploads') {
  if (!file?.buffer) {
    throw ApiError.badRequest('No file provided');
  }

  const key = buildKey(folder, file.originalname);

  await getClient().send(
    new PutObjectCommand({
      Bucket: env.aws.bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype || 'application/octet-stream',
    }),
  );

  return {
    key,
    url: getS3PublicUrl(key),
    fileName: path.basename(key),
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
  };
}

/**
 * Recover the object key from a stored URL, so a record that only kept the
 * public URL (older documents did) can still have its object removed.
 * Returns '' for anything that isn't an object in our bucket.
 */
export function s3KeyFromUrl(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const { hostname, pathname } = new URL(url);
    if (!hostname.includes('.s3.') && !hostname.startsWith('s3.')) return '';
    // Both bucket-in-host and bucket-in-path URL styles resolve to the same key.
    const decoded = decodeURIComponent(pathname.replace(/^\//, ''));
    return hostname.startsWith(`${env.aws.bucket}.`)
      ? decoded
      : decoded.replace(new RegExp(`^${env.aws.bucket}/`), '');
  } catch {
    return '';
  }
}

/**
 * Remove one object. Best-effort by design: this is called while purging a
 * deleted account, and a missing or already-removed object must not abort the
 * rest of the purge.
 */
export async function deleteFileFromS3(key) {
  if (!env.aws.enabled || !key) return false;
  try {
    await getClient().send(
      new DeleteObjectCommand({ Bucket: env.aws.bucket, Key: key }),
    );
    return true;
  } catch (err) {
    console.error(`[s3] failed to delete ${key}: ${err.message}`);
    return false;
  }
}

/**
 * Download one object as a Buffer, using the same client that uploaded it — so
 * it works whatever region/permissions other AWS services (e.g. Rekognition)
 * would have needed to read the bucket themselves.
 */
export async function getFileFromS3(key) {
  const response = await getClient().send(
    new GetObjectCommand({ Bucket: env.aws.bucket, Key: key }),
  );
  return Buffer.from(await response.Body.transformToByteArray());
}
