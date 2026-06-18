import mongoose from 'mongoose';

const accessRequestSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // Backward-compatible alias used by existing services.
    employeeUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    employeeName: { type: String, required: true },
    requestType: {
      type: String,
      enum: ['profile_access', 'background_check', 'verification_data', 'full_profile_access'],
      default: 'profile_access',
    },
    message: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'accepted', 'revoked'],
      default: 'pending',
      index: true,
    },
    requestedAt: { type: Date, default: Date.now },
    respondedAt: { type: Date, default: null },
    activityLogId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ActivityLog',
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

accessRequestSchema.index({ companyId: 1, status: 1, createdAt: -1 });

export const AccessRequest = mongoose.model('AccessRequest', accessRequestSchema);
