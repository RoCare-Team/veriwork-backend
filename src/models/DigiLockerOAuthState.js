import mongoose from 'mongoose';

const digiLockerOAuthStateSchema = new mongoose.Schema(
  {
    stateHash: { type: String, required: true, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    scopes: { type: String, required: true },
    // PKCE code_verifier, encrypted at rest; sent back on the token exchange.
    codeVerifierEncrypted: { type: String, required: true },
    // Where the flow started; decides the page the callback returns to.
    purpose: { type: String, enum: ['aadhaar', 'settings'], default: 'aadhaar' },
    expiresAt: { type: Date, required: true, index: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

digiLockerOAuthStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const DigiLockerOAuthState = mongoose.model('DigiLockerOAuthState', digiLockerOAuthStateSchema);