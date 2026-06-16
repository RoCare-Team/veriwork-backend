import mongoose from 'mongoose';

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
    skills: [{ type: String }],
    profileSetupComplete: { type: Boolean, default: false },
    aadhaarVerified: { type: Boolean, default: false },
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
  },
  { timestamps: true },
);

export const EmployeeProfile = mongoose.model('EmployeeProfile', employeeProfileSchema);
