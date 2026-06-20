import mongoose from 'mongoose';

const publicProfileAccessRequestSchema = new mongoose.Schema(
  {
    employeeUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    employeeName: { type: String, default: '' },
    publicSlug: { type: String, default: '' },
    requesterName: { type: String, required: true },
    requesterEmail: { type: String, required: true },
    reason: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    respondedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

publicProfileAccessRequestSchema.index({ employeeUserId: 1, requesterEmail: 1, status: 1 });

export const PublicProfileAccessRequest = mongoose.model(
  'PublicProfileAccessRequest',
  publicProfileAccessRequestSchema,
);
