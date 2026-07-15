import mongoose from 'mongoose';

const employmentDetailsSchema = new mongoose.Schema(
  {
    workedHere: { type: Boolean, default: null },
    designation: { type: String, default: '' },
    joiningDate: { type: String, default: '' },
    exitDate: { type: String, default: '' },
    duration: { type: String, default: '' },
    feedback: { type: String, default: '' },
    rehireEligible: { type: Boolean, default: null },
    verificationNotes: { type: String, default: '' },
    employmentType: { type: String, default: '' },
    employmentStatus: { type: String, default: '' },
    employeeCode: { type: String, default: '' },
    department: { type: String, default: '' },
    workLocation: { type: String, default: '' },
    uanNumber: { type: String, default: '' },
    pfNumber: { type: String, default: '' },
    esiNumber: { type: String, default: '' },
    companyPan: { type: String, default: '' },
    companyCin: { type: String, default: '' },
    companyGst: { type: String, default: '' },
    lastDrawnSalary: { type: String, default: '' },
    // Structured HR verification form
    reportingManager: { type: String, default: '' },
    performanceRating: {
      type: String,
      enum: ['excellent', 'good', 'average', 'below_average', 'poor', ''],
      default: '',
    },
    behaviorRemarks: { type: String, default: '' },
    disciplinaryIssues: { type: Boolean, default: null },
    disciplinaryDetails: { type: String, default: '' },
    recommendation: {
      type: String,
      enum: ['strongly_recommend', 'recommend', 'neutral', 'not_recommend', ''],
      default: '',
    },
    hrRemarks: { type: String, default: '' },
    supportingDocumentUrl: { type: String, default: '' },
    supportingDocumentName: { type: String, default: '' },
    // Verifier identity + declaration
    verifierName: { type: String, default: '' },
    verifierDesignation: { type: String, default: '' },
    verifierEmail: { type: String, default: '' },
    verifierPhone: { type: String, default: '' },
    declarationAccepted: { type: Boolean, default: false },
  },
  { _id: false },
);

const verificationRequestSchema = new mongoose.Schema(
  {
    initiatedBy: {
      type: String,
      enum: ['employee', 'company'],
      default: 'company',
      index: true,
    },
    requestingCompanyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      default: null,
      index: true,
    },
    targetCompanyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      default: null,
      index: true,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    jobExperienceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JobExperience',
      required: true,
      index: true,
    },
    previousCompanyName: { type: String, required: true },
    verificationChannel: {
      type: String,
      enum: ['platform', 'email'],
      required: true,
    },
    verificationLevel: {
      type: String,
      enum: ['document_verified', 'hr_verified', 'employer_verified', null],
      default: null,
    },
    hrEmail: { type: String, default: '' },
    managerEmail: { type: String, default: '' },
    // Additional HR recipients beyond hrEmail/managerEmail — see
    // sendVerificationEmails, which mails the union of all three.
    hrContacts: { type: [String], default: [] },
    hrName: { type: String, default: '' },
    status: {
      type: String,
      enum: [
        'pending_employee_consent',
        'pending',
        'in_review',
        'hr_responded',
        'verified',
        'rejected',
        'expired',
        'in_process',
        'approved',
      ],
      default: 'pending',
      index: true,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    requestedAt: { type: Date, default: Date.now },
    respondedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    respondedAt: { type: Date, default: null },
    verificationResult: {
      type: String,
      enum: ['verified', 'rejected', null],
      default: null,
    },
    employmentDetails: { type: employmentDetailsSchema, default: () => ({}) },
    externalToken: { type: String, default: null, index: true },
    externalTokenExpiresAt: { type: Date, default: null },
    // Delivery tracking for the email channel so the dashboard can show sent/failed + allow resend.
    emailStatus: {
      type: String,
      enum: ['not_applicable', 'not_sent', 'sent', 'mock', 'failed'],
      default: 'not_applicable',
    },
    emailLastSentAt: { type: Date, default: null },
    scoreImpactApplied: { type: Boolean, default: false },
    notes: { type: String, default: '' },
    resolvedVia: {
      type: String,
      enum: ['hr_response', 'employer_platform', 'document_fallback', 'company_review', null],
      default: null,
    },
  },
  { timestamps: true },
);

verificationRequestSchema.index({ requestingCompanyId: 1, status: 1, createdAt: -1 });
verificationRequestSchema.index({ targetCompanyId: 1, status: 1, createdAt: -1 });
verificationRequestSchema.index({ employeeId: 1, jobExperienceId: 1, status: 1 });

export const VerificationRequest = mongoose.model('VerificationRequest', verificationRequestSchema);
