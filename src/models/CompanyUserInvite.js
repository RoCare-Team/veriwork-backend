import mongoose from 'mongoose';

/**
 * An invite for a staff member (HR, recruiter, …) to join a company's employer
 * portal. The invitee sets their own password via the tokenised link, so we never
 * store a password the admin chose for them.
 */
const companyUserInviteSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    name: { type: String, default: '' },
    // Preset role key. Ignored when companyRoleId points at a custom role.
    companyRole: {
      type: String,
      enum: ['owner', 'admin', 'hr_manager', 'recruiter', 'viewer'],
      required: true,
    },
    companyRoleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CompanyRole',
      default: null,
    },
    token: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'revoked', 'expired'],
      default: 'pending',
      index: true,
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    acceptedAt: { type: Date, default: null },
    emailStatus: {
      type: String,
      enum: ['sent', 'mock', 'failed', 'not_sent'],
      default: 'not_sent',
    },
  },
  { timestamps: true },
);

companyUserInviteSchema.index({ companyId: 1, status: 1, createdAt: -1 });

export const CompanyUserInvite = mongoose.model('CompanyUserInvite', companyUserInviteSchema);
