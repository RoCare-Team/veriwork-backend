import { VaultItem } from '../models/VaultItem.js';
import { Document } from '../models/Document.js';
import { ApiError } from '../utils/ApiError.js';
import { storeUploadedFile } from '../utils/fileUpload.js';

const VAULT_CATEGORIES = [
  { id: 'identity', label: 'Identity' },
  { id: 'education', label: 'Education' },
  { id: 'experience', label: 'Experience' },
  { id: 'financial', label: 'Financial' },
];

function formatVaultItem(item) {
  return {
    id: item._id,
    category: item.category,
    name: item.name,
    size: item.size,
    status: item.status,
    documentId: item.documentId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export async function listVaultItems(userId) {
  const items = await VaultItem.find({ userId }).sort({ createdAt: -1 });
  const verifiedCount = items.filter((item) => item.status === 'verified').length;

  const categories = VAULT_CATEGORIES.map((category) => ({
    ...category,
    count: items.filter((item) => item.category === category.id).length,
  }));

  return {
    summary: {
      totalDocuments: items.length,
      verifiedCount,
      encrypted: true,
    },
    categories,
    recentDocuments: items.slice(0, 10).map(formatVaultItem),
    items: items.map(formatVaultItem),
  };
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

  const item = await VaultItem.create({
    userId,
    category: data.category,
    name: data.name,
    size: data.size || (file ? `${Math.round(file.size / 1024)} KB` : ''),
    documentId,
    status: 'pending',
  });

  return formatVaultItem(item);
}

export async function getVaultItem(userId, itemId) {
  const item = await VaultItem.findOne({ _id: itemId, userId });
  if (!item) throw ApiError.notFound('Vault item not found');
  return formatVaultItem(item);
}
