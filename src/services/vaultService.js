import { VaultItem } from '../models/VaultItem.js';
import { Document } from '../models/Document.js';
import { ApiError } from '../utils/ApiError.js';
import { storeUploadedFile } from '../utils/fileUpload.js';
export async function listVaultItems(userId) {
  return VaultItem.find({ userId }).sort({ createdAt: -1 });
}

export async function createVaultItem(userId, data, file) {
  let documentId = null;

  if (file) {
    const stored = await storeUploadedFile(file, `vault/${data.category}`);
    const doc = await Document.create({
      userId,
      category: data.category,
      fileName: stored.fileName,
      originalName: stored.originalName,
      mimeType: stored.mimeType,
      size: stored.size,
      url: stored.url,
    });
    documentId = doc._id;
  }

  return VaultItem.create({
    userId,
    category: data.category,
    name: data.name,
    size: data.size || (file ? `${Math.round(file.size / 1024)} KB` : ''),
    documentId,
    status: file ? 'pending' : 'pending',
  });
}

export async function getVaultItem(userId, itemId) {
  const item = await VaultItem.findOne({ _id: itemId, userId });
  if (!item) throw ApiError.notFound('Vault item not found');
  return item;
}
