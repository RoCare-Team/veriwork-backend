import mongoose from 'mongoose';

const educationLevelSchema = {
  board: { type: String, default: '' },
  school: { type: String, default: '' },
  stream: { type: String, default: '' },
  degree: { type: String, default: '' },
  college: { type: String, default: '' },
  university: { type: String, default: '' },
  passingYear: { type: String, default: '' },
  percentage: { type: String, default: '' },
};

// Per-employee SMTP config so verification emails to a past employer's HR are
// sent from the employee's own mailbox. Password stored encrypted (utils/crypto.js).
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

const employeeProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    phone: { type: String, required: true },
    name: { type: String, default: '' },
    email: { type: String, default: '' },
    dateOfBirth: { type: String, default: '' },
    gender: {
      type: String,
      enum: ['male', 'female', 'other', 'prefer_not_to_say', ''],
      default: '',
    },
    role: { type: String, default: '' },
    company: { type: String, default: '' },
    totalExperience: { type: String, default: '' },
    currentCity: { type: String, default: '' },
    currentAddress: { type: String, default: '' },
    permanentAddress: { type: String, default: '' },
    education: {
      class10: { type: educationLevelSchema, default: () => ({}) },
      class12: { type: educationLevelSchema, default: () => ({}) },
      graduation: { type: educationLevelSchema, default: () => ({}) },
    },
    skills: [{ type: String }],
    profileSetupComplete: { type: Boolean, default: false },
    aadhaarVerified: { type: Boolean, default: false },
    panVerified: { type: Boolean, default: false },
    biometricVerified: { type: Boolean, default: false },
    digilockerUsed: { type: Boolean, default: false },
    photoUrl: { type: String, default: null },
    veriworkId: { type: String, required: true, unique: true },
    publicSlug: { type: String, required: true, unique: true },
    endorsements: { type: Number, default: 0, min: 0 },
    scoreCached: { type: Number, default: 300 },
    notificationsEnabled: { type: Boolean, default: true },
    publicProfileEnabled: { type: Boolean, default: true },
    language: { type: String, default: 'en-US' },
    smtp: { type: smtpSettingsSchema, default: () => ({}) },
  },
  { timestamps: true },
);

export const EmployeeProfile = mongoose.model('EmployeeProfile', employeeProfileSchema);
