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
