import { z } from 'zod';

const phoneField = z.preprocess(
  (val) => (typeof val === 'string' ? val.replace(/\s+/g, '') : val),
  z
    .string()
    .min(10, 'Mobile number must be at least 10 digits')
    .refine((val) => val.replace(/\D/g, '').length >= 10, {
      message: 'Mobile number must be at least 10 digits',
    }),
);

const dateOfBirthField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be YYYY-MM-DD')
  .refine((val) => !Number.isNaN(Date.parse(val)), {
    message: 'Invalid date of birth',
  });

const sameAddressField = z.preprocess(
  (val) => val === true || val === 'true',
  z.boolean().optional(),
);

export const updateProfileSchema = z.object({
  name: z.string().min(1, 'Full name is required').max(100).optional(),
  phone: phoneField.optional(),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
  dateOfBirth: dateOfBirthField.optional(),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
  role: z.string().min(1, 'Current role is required').max(100).optional(),
  company: z.string().min(1, 'Current company is required').max(150).optional(),
  totalExperience: z.string().min(1, 'Total experience is required').max(50).optional(),
  currentCity: z.string().min(1, 'Current city is required').max(100).optional(),
  currentAddress: z.string().min(1, 'Current address is required').max(300).optional(),
  permanentAddress: z.string().max(300).optional(),
  sameAsCurrentAddress: sameAddressField,
  skills: z.array(z.string()).optional(),
  invitationToken: z.string().min(10).optional(),
});

export const setupProfileSchema = z
  .object({
    name: z.string().min(1, 'Full name is required').max(100),
    phone: phoneField,
    email: z.string().email('Invalid email address'),
    dateOfBirth: dateOfBirthField,
    gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say'], {
      required_error: 'Gender is required',
    }),
    role: z.string().min(1, 'Current role is required').max(100),
    company: z.string().min(1, 'Current company is required').max(150),
    totalExperience: z.string().min(1, 'Total experience is required').max(50),
    currentCity: z.string().min(1, 'Current city is required').max(100),
    currentAddress: z.string().min(1, 'Current address is required').max(300),
    permanentAddress: z.string().max(300).optional(),
    sameAsCurrentAddress: sameAddressField,
    invitationToken: z.string().min(10).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.sameAsCurrentAddress && !data.permanentAddress?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Permanent address is required',
        path: ['permanentAddress'],
      });
    }
  });

export const aadhaarVerifySchema = z.object({
  method: z.enum(['digilocker', 'otp']).default('digilocker'),
  aadhaarNumber: z.string().optional(),
  otp: z.string().optional(),
});

export const endorseEmployeeSchema = z.object({
  veriworkId: z.string().min(3, 'PagerLook ID is required'),
  message: z.string().max(300).optional(),
  relationship: z.enum(['colleague', 'manager', 'hr', 'other']).default('colleague'),
});

export const createJobSchema = z.object({
  title: z.string().min(1),
  company: z.string().min(1),
  employmentType: z.string().optional(),
  salaryBand: z.string().optional(),
  joiningDate: z.string().optional(),
  exitDate: z.string().optional(),
  isPresent: z.boolean().optional(),
  duration: z.string().optional(),
  companyEmail: z.string().optional(),
  hrEmail: z.string().optional(),
  description: z.string().optional(),
});

export const activityActionSchema = z.object({
  status: z.enum(['approved', 'denied']),
});

export const createVaultItemSchema = z.object({
  category: z.enum(['identity', 'education', 'experience', 'financial']),
  name: z.string().min(1),
  size: z.string().optional(),
});

export const activityQuerySchema = z.object({
  filter: z.enum(['all', 'requests', 'updates']).optional(),
});

export const updateSettingsSchema = z.object({
  notificationsEnabled: z.boolean().optional(),
  publicProfileEnabled: z.boolean().optional(),
  language: z.string().min(2).max(20).optional(),
});
