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
    description: { type: String, default: '' },
    status: {
      type: String,
      enum: ['verified', 'in_process', 'not_verified'],
      default: 'in_process',
    },
  },
  { timestamps: true },
);

export const JobExperience = mongoose.model('JobExperience', jobExperienceSchema);
