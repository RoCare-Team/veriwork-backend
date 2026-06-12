import mongoose from 'mongoose';

const joinRequestSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    candidateUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    name: { type: String, required: true },
    role: { type: String, required: true },
    department: { type: String, default: '' },
    employeeScore: { type: Number, default: 300 },
    joiningDate: { type: String, default: '' },
    salaryBand: { type: String, default: '' },
    documents: [{ type: String }],
    avatar: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
  },
  { timestamps: true },
);

export const JoinRequest = mongoose.model('JoinRequest', joinRequestSchema);
