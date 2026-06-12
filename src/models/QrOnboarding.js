import mongoose from 'mongoose';

const qrOnboardingSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    label: { type: String, required: true },
    code: { type: String, required: true, unique: true },
    scans: { type: Number, default: 0 },
    joined: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const QrOnboarding = mongoose.model('QrOnboarding', qrOnboardingSchema);
