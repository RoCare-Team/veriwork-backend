import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    email: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },
    googleId: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    authProvider: {
      type: String,
      enum: ['phone', 'google'],
      default: 'phone',
    },
    passwordHash: {
      type: String,
    },
    role: {
      type: String,
      enum: ['employee', 'enterprise_admin', 'platform_admin'],
      required: true,
    },
    // Company-scoped role — decides what an enterprise_admin can see/do inside the
    // portal. Ignored for employees / platform admins. See utils/permissions.js.
    // A preset role key; ignored when companyRoleId points at a custom role.
    companyRole: {
      type: String,
      enum: ['owner', 'admin', 'hr_manager', 'recruiter', 'viewer', null],
      default: null,
    },
    // Set when the user is on a company-defined custom role. Takes precedence
    // over `companyRole`.
    companyRoleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CompanyRole',
      default: null,
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

export const User = mongoose.model('User', userSchema);
