import mongoose from 'mongoose';

const verificationRequestSchema = new mongoose.Schema(
  {
    requestingCompanyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    targetCompanyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      default: null,
      index: true,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    jobExperienceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JobExperience',
      required: true,
      index: true,
    },
    previousCompanyName: { type: String, required: true },
    verificationChannel: {
      type: String,
      enum: ['platform', 'email'],
      required: true,
    },
    hrEmail: { type: String, default: '' },
    hrName: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'in_process', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    requestedAt: { type: Date, default: Date.now },
    respondedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    respondedAt: { type: Date, default: null },
    verificationResult: {
      type: String,
      enum: ['verified', 'rejected', null],
      default: null,
    },
    scoreImpactApplied: { type: Boolean, default: false },
    notes: { type: String, default: '' },
  },
  { timestamps: true },
);

verificationRequestSchema.index({ requestingCompanyId: 1, status: 1, createdAt: -1 });
verificationRequestSchema.index({ targetCompanyId: 1, status: 1, createdAt: -1 });

export const VerificationRequest = mongoose.model('VerificationRequest', verificationRequestSchema);
