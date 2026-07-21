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
    /**
     * Per-document review outcome, keyed the same way as `documents`.
     * Lets an admin reject just the GST certificate without voiding an otherwise
     * good application — the company re-uploads that one file and resubmits.
     */
    documentReviews: {
      type: Map,
      of: new mongoose.Schema(
        {
          status: {
            type: String,
            enum: ['pending', 'approved', 'rejected'],
            default: 'pending',
          },
          reason: { type: String, default: '' },
          reviewedAt: { type: Date, default: null },
          reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        },
        { _id: false },
      ),
      default: {},
    },
    certified: { type: Boolean, default: false },
    rejectionReason: { type: String, default: '' },
    reviewedAt: { type: Date },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: {
      type: String,
      // changes_requested: specific documents were rejected; the company can fix
      // just those and resubmit, rather than starting over.
      enum: ['draft', 'submitted', 'changes_requested', 'approved', 'rejected'],
      default: 'draft',
    },
  },
  { timestamps: true },
);

export const CompanyOnboarding = mongoose.model('CompanyOnboarding', companyOnboardingSchema);
