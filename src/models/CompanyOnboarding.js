import mongoose from 'mongoose';

const companyOnboardingSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      unique: true,
    },
    basicInfo: {
      companyName: { type: String, default: '' },
      industry: { type: String, default: '' },
      companySize: { type: String, default: '' },
      workEmail: { type: String, default: '' },
      contactName: { type: String, default: '' },
      phone: { type: String, default: '' },
      country: { type: String, default: '' },
      city: { type: String, default: '' },
    },
    registration: {
      brn: { type: String, default: '' },
      taxId: { type: String, default: '' },
    },
    documents: {
      type: Map,
      of: String,
      default: {},
    },
    certified: { type: Boolean, default: false },
    rejectionReason: { type: String, default: '' },
    reviewedAt: { type: Date },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: {
      type: String,
      enum: ['draft', 'submitted', 'approved', 'rejected'],
      default: 'draft',
    },
  },
  { timestamps: true },
);

export const CompanyOnboarding = mongoose.model('CompanyOnboarding', companyOnboardingSchema);
