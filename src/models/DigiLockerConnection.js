import mongoose from 'mongoose';

const digiLockerConnectionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    provider: { type: String, enum: ['digilocker'], default: 'digilocker', required: true },
    providerUserId: { type: String, default: null, trim: true },
    accessTokenEncrypted: { type: String, required: true },
    refreshTokenEncrypted: { type: String, default: '' },
    tokenExpiresAt: { type: Date, default: null },
    scopes: { type: [String], default: [] },
    // Identity DigiLocker returns with the v2 token (openid). Shown to the
    // employee/admin; never used on its own to mark Aadhaar as verified.
    identity: {
      name: { type: String, default: '' },
      dob: { type: String, default: '' },
      gender: { type: String, default: '' },
      eaadhaarLinked: { type: Boolean, default: false },
    },
    connectedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['connected', 'revoked', 'error'], default: 'connected' },
  },
  { timestamps: true },
);

digiLockerConnectionSchema.index({ userId: 1, provider: 1 }, { unique: true });

export const DigiLockerConnection = mongoose.model('DigiLockerConnection', digiLockerConnectionSchema);