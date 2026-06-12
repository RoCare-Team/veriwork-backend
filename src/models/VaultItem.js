import mongoose from 'mongoose';

const vaultItemSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    category: {
      type: String,
      enum: ['identity', 'education', 'experience', 'financial'],
      required: true,
    },
    name: { type: String, required: true },
    size: { type: String, default: '' },
    status: {
      type: String,
      enum: ['verified', 'pending'],
      default: 'pending',
    },
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
    },
  },
  { timestamps: true },
);

export const VaultItem = mongoose.model('VaultItem', vaultItemSchema);
