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
    role: { type: String, default: '' },
    company: { type: String, default: '' },
    email: { type: String, default: '' },
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
  },
  { timestamps: true },
);

export const EmployeeProfile = mongoose.model('EmployeeProfile', employeeProfileSchema);
