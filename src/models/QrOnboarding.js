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
    // Pre-set the role a scanned candidate is applying into, so the QR can be
    // handed out per-desk/per-drive without the candidate guessing.
    department: { type: String, default: '' },
    designation: { type: String, default: '' },
    scans: { type: Number, default: 0 },
    joined: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true },
);

export const QrOnboarding = mongoose.model('QrOnboarding', qrOnboardingSchema);
