import fs from 'fs';
import path from 'path';
import { env } from '../config/env.js';
import { uploadFileToS3 } from '../services/s3Service.js';

const uploadDir = path.resolve(env.upload.dir);

function ensureUploadDir() {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
}

async function storeLocally(file) {
  ensureUploadDir();
  const ext = path.extname(file.originalname);
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
  const filePath = path.join(uploadDir, fileName);

  await fs.promises.writeFile(filePath, file.buffer);

  return {
    url: `/uploads/${fileName}`,
    fileName,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
  };
}

export async function storeUploadedFile(file, folder = 'uploads') {
  if (!file) return null;

  if (env.aws.enabled) {
    return uploadFileToS3(file, folder);
  }

  return storeLocally(file);
}

/**
 * Read back a file previously written by storeLocally. Only used for locally
 * stored images (S3 objects are read by key), so anything that isn't an
 * /uploads/<name> path returns null rather than touching the filesystem.
 */
export async function readLocalUpload(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('/uploads/')) return null;

  const fileName = path.basename(url);
  const filePath = path.join(uploadDir, fileName);
  // Guard against traversal via a crafted url.
  if (path.dirname(path.resolve(filePath)) !== uploadDir) return null;

  try {
    return await fs.promises.readFile(filePath);
  } catch {
    return null;
  }
}
