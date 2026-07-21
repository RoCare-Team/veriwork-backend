import mongoose from 'mongoose';
import { MODULES } from '../utils/permissions.js';

/**
 * A company-defined role. Presets (owner/admin/hr_manager/…) live in code and are
 * shared by every company; these are extra roles an admin builds themselves,
 * ticking exactly which modules the role may view or manage.
 */
const permissionsShape = MODULES.reduce((acc, module) => {
  acc[module] = {
    type: String,
    enum: ['none', 'view', 'manage'],
    default: 'none',
  };
  return acc;
}, {});

const companyRoleSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    permissions: {
      type: new mongoose.Schema(permissionsShape, { _id: false }),
      default: () => ({}),
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true },
);

// Role names are unique per company so a dropdown can never show two "HR Lead"s.
companyRoleSchema.index({ companyId: 1, name: 1 }, { unique: true });

export const CompanyRole = mongoose.model('CompanyRole', companyRoleSchema);
