import mongoose from 'mongoose';

const companyEmployeeInvitationSchema = new mongoose.Schema(
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
      default: null,
      index: true,
    },
    employeeName: { type: String, default: '' },
    employeeEmail: { type: String, default: '' },
    employeeMobile: { type: String, default: '' },
    employeeVeriworkId: { type: String, default: '' },
    department: { type: String, default: '' },
    designation: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'pending_registration', 'accepted', 'rejected', 'expired'],
      default: 'pending',
      index: true,
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    invitedAt: { type: Date, default: Date.now },
    respondedAt: { type: Date, default: null },
    registrationToken: { type: String, default: null, index: true },
    registrationTokenExpiresAt: { type: Date, default: null },
    autoJoinOnSetup: { type: Boolean, default: false },
    emailSentAt: { type: Date, default: null },
  },
  { timestamps: true },
);

companyEmployeeInvitationSchema.index({ companyId: 1, employeeEmail: 1, status: 1 });
companyEmployeeInvitationSchema.index({ companyId: 1, employeeMobile: 1, status: 1 });
companyEmployeeInvitationSchema.index({ companyId: 1, employeeVeriworkId: 1, status: 1 });

export const CompanyEmployeeInvitation = mongoose.model(
  'CompanyEmployeeInvitation',
  companyEmployeeInvitationSchema,
);
