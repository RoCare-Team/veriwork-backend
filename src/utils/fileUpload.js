import fs from 'fs';
import path from 'path';
import { env } from '../config/env.js';
import { deleteFileFromS3, s3KeyFromUrl, uploadFileToS3 } from '../services/s3Service.js';

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

/**
 * Delete a file previously written by storeUploadedFile, wherever it landed —
 * an S3 object or a local /uploads/<name>. Used when purging a deleted account,
 * so it never throws: a file that is already gone is simply reported as false.
 *
 * @param {string} url  The stored URL (S3 public URL or /uploads/<name>).
 * @param {string} [key] The S3 object key when the record kept one; otherwise
 *                       it is recovered from the URL.
 */
export async function deleteStoredFile(url, key = '') {
  if (!url && !key) return false;

  const objectKey = key || s3KeyFromUrl(url);
  if (objectKey) return deleteFileFromS3(objectKey);

  if (typeof url !== 'string' || !url.startsWith('/uploads/')) return false;

  const filePath = path.join(uploadDir, path.basename(url));
  // Same traversal guard as readLocalUpload — never unlink outside uploadDir.
  if (path.dirname(path.resolve(filePath)) !== uploadDir) return false;

  try {
    await fs.promises.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}
