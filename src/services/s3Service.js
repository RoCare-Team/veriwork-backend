import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
