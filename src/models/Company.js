import mongoose from 'mongoose';

const companySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    industry: { type: String, default: '' },
    companySize: { type: String, default: '' },
    workEmail: { type: String, required: true },
    contactName: { type: String, default: '' },
    phone: { type: String, default: '' },
    country: { type: String, default: '' },
    city: { type: String, default: '' },
    brn: { type: String, default: '' },
    taxId: { type: String, default: '' },
    isVerified: { type: Boolean, default: false },
    onboardingComplete: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const Company = mongoose.model('Company', companySchema);
