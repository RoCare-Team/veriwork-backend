import mongoose from 'mongoose';

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
