import mongoose from 'mongoose';

const companyAuditLogSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    actorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    action: {
      type: String,
      enum: [
        'invitation_sent',
        'invitation_accepted',
        'invitation_rejected',
        'access_request_created',
        'access_request_approved',
        'access_request_rejected',
        'access_request_revoked',
        'verification_request_created',
        'verification_request_received',
        'verification_request_approved',
        'verification_request_rejected',
        'verification_consent_approved',
        'verification_consent_rejected',
        'verification_hr_response_approved',
        'verification_hr_response_rejected',
        'verification_document_confirmed',
        'verification_email_resent',
        'employee_onboarding_assigned',
      ],
      required: true,
      index: true,
    },
    entityType: { type: String, default: '' },
    entityId: { type: String, default: '' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

companyAuditLogSchema.index({ companyId: 1, createdAt: -1 });

export const CompanyAuditLog = mongoose.model('CompanyAuditLog', companyAuditLogSchema);
