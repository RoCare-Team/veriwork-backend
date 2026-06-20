import mongoose from 'mongoose';

const companyEmployeeSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    employeeName: { type: String, default: '' },
    department: { type: String, default: '' },
    designation: { type: String, default: '' },
    reportingManagerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    onboardingStage: {
      type: String,
      enum: ['incoming', 'pending_verification', 'verified', 'active'],
      default: 'incoming',
      index: true,
    },
    employmentStatus: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
      index: true,
    },
    joinedAt: { type: Date, default: Date.now },
    verifiedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

companyEmployeeSchema.index({ companyId: 1, employeeId: 1 }, { unique: true });

export const CompanyEmployee = mongoose.model('CompanyEmployee', companyEmployeeSchema);
