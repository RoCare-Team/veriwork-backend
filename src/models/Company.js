import mongoose from 'mongoose';

// Per-company SMTP configuration used to send verification emails from the
// company's own mailbox. The password is stored encrypted at rest (see utils/crypto.js).
const smtpSettingsSchema = new mongoose.Schema(
  {
    host: { type: String, default: '' },
    port: { type: Number, default: 587 },
    secure: { type: Boolean, default: false },
    username: { type: String, default: '' },
    passwordEnc: { type: String, default: '' },
    senderName: { type: String, default: '' },
    senderEmail: { type: String, default: '' },
    configured: { type: Boolean, default: false },
    updatedAt: { type: Date, default: null },
  },
  { _id: false },
);

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
    smtp: { type: smtpSettingsSchema, default: () => ({}) },
  },
  { timestamps: true },
);

export const Company = mongoose.model('Company', companySchema);
