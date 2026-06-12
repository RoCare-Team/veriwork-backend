import mongoose from 'mongoose';

const activityLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['consent_request', 'access_request', 'verification', 'job', 'system'],
      default: 'system',
    },
    title: { type: String, required: true },
    message: { type: String, default: '' },
    company: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'approved', 'denied', 'info'],
      default: 'info',
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

export const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);
