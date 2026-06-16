import multer from 'multer';
import { env } from '../config/env.js';

const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const DOC_TYPES = new Set([
  'application/pdf',
  ...IMAGE_TYPES,
]);

function createUpload(allowedTypes, maxMb = env.upload.maxFileSizeMb) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMb * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (allowedTypes.has(file.mimetype)) {
        cb(null, true);
        return;
      }
      cb(new Error('File type not allowed'));
    },
  });
}

export const upload = createUpload(DOC_TYPES);
export const uploadPhoto = createUpload(IMAGE_TYPES, 5);
