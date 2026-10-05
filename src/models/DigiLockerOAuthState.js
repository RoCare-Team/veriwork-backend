import mongoose from 'mongoose';

const digiLockerOAuthStateSchema = new mongoose.Schema(
  {
    stateHash: { type: String, required: true, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    scopes: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

digiLockerOAuthStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const DigiLockerOAuthState = mongoose.model('DigiLockerOAuthState', digiLockerOAuthStateSchema);