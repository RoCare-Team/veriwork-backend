import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JobExperience',
    },
    documentType: {
      type: String,
      enum: ['offer_letter', 'salary_slip', 'experience_letter', 'relieving_letter', 'other'],
      default: 'other',
    },
    category: {
      type: String,
      enum: ['identity', 'education', 'experience', 'financial', 'job', 'company', 'other'],
      default: 'other',
    },
    fileName: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, default: '' },
    size: { type: Number, default: 0 },
    url: { type: String, required: true },
    status: {
      type: String,
      enum: ['verified', 'pending', 'rejected'],
      default: 'pending',
    },
  },
  { timestamps: true },
);

export const Document = mongoose.model('Document', documentSchema);
