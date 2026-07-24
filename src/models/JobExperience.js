import mongoose from 'mongoose';

/**
 * One role held at the same company. Lets an employee record their progression
 * — e.g. joined as Software Engineer, promoted to Senior Software Engineer —
 * so a verifier can confirm the whole journey, not just the final title.
 */
const jobPositionSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    fromDate: { type: String, default: '' },
    toDate: { type: String, default: '' },
    isCurrent: { type: Boolean, default: false },
    yearlyPackage: { type: String, default: '' },
    monthlyInHandSalary: { type: String, default: '' },
  },
  { _id: false },
);

const jobExperienceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: { type: String, required: true },
    company: { type: String, required: true },
    employmentType: { type: String, default: '' },
    salaryBand: { type: String, default: '' },
    joiningDate: { type: String, default: '' },
    exitDate: { type: String, default: '' },
    isPresent: { type: Boolean, default: false },
    duration: { type: String, default: '' },
    companyEmail: { type: String, default: '' },
    // Full list of HR contacts to notify. hrEmail/managerEmail below mirror
    // hrContacts[0]/[1] so existing readers (companyLinkingService, older rows)
    // keep working; hrContacts is the source of truth for 3+ contacts.
    hrContacts: { type: [String], default: [] },
    hrEmail: { type: String, default: '' },
    managerEmail: { type: String, default: '' },
    managerName: { type: String, default: '' },
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
    // Monthly take-home the employee declares; HR confirms the exact figure
    // during verification (see salaryVerificationStatus on VerificationRequest).
    monthlyInHandSalary: { type: String, default: '' },
    // Annual CTC for the role, alongside the monthly take-home above.
    yearlyPackage: { type: String, default: '' },
    // Career progression within this same company (oldest → newest).
    positions: { type: [jobPositionSchema], default: [] },
    description: { type: String, default: '' },
    status: {
      type: String,
      enum: ['verified', 'in_process', 'not_verified'],
      default: 'not_verified',
    },
    verificationLevel: {
      type: String,
      enum: ['none', 'document_verified', 'hr_verified', 'employer_verified'],
      default: 'none',
    },
    verifiedAt: { type: Date, default: null },
    verificationFeedback: { type: String, default: '' },
    rehireEligible: { type: Boolean, default: null },
    verificationNotes: { type: String, default: '' },
    confidenceScore: { type: Number, default: null, min: 0, max: 100 },
  },
  { timestamps: true },
);

export const JobExperience = mongoose.model('JobExperience', jobExperienceSchema);
