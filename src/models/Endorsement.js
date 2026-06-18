import mongoose from 'mongoose';

const endorsementSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    endorsedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    endorserName: { type: String, default: '' },
    relationship: {
      type: String,
      enum: ['colleague', 'manager', 'hr', 'other'],
      default: 'colleague',
    },
    message: { type: String, default: '', maxLength: 300 },
  },
  { timestamps: true },
);

endorsementSchema.index({ employeeId: 1, endorsedBy: 1 }, { unique: true });

export const Endorsement = mongoose.model('Endorsement', endorsementSchema);
