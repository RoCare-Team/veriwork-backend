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

const passingYearField = z
  .string()
  .regex(/^\d{4}$/, 'Passing year must be a 4-digit year')
  .refine((val) => {
    const year = Number(val);
    return year >= 1970 && year <= new Date().getFullYear() + 1;
  }, { message: 'Passing year is out of range' });

const percentageField = z.string().max(20).optional().or(z.literal(''));

/*
 * Education is optional to submit — a user can skip it during setup and add it
 * later to earn score. But a PARTIALLY filled level is rejected: half a record
 * is worse than none, since it looks verified but isn't. So each level is
 * either entirely empty or has its key fields.
 */
const optionalText = (max) => z.string().max(max).optional().or(z.literal(''));

function requireCompleteLevel(levelLabel, requiredFields) {
  return (data, ctx) => {
    if (!data) return;
    const values = Object.values(data).map((v) => (typeof v === 'string' ? v.trim() : v));
    const isEmpty = values.every((v) => !v);
    if (isEmpty) return; // skipped entirely — allowed

    for (const [field, label] of Object.entries(requiredFields)) {
      if (!data[field]?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} is required to save ${levelLabel}`,
          path: [field],
        });
      }
    }
  };
}

const class10EducationSchema = z
  .object({
    board: optionalText(100),
    school: optionalText(150),
    passingYear: passingYearField.optional().or(z.literal('')),
    percentage: percentageField,
  })
  .superRefine(requireCompleteLevel('Class 10', { board: 'Board', school: 'School name' }));

const class12EducationSchema = z
  .object({
    board: optionalText(100),
    school: optionalText(150),
    stream: optionalText(50),
    passingYear: passingYearField.optional().or(z.literal('')),
    percentage: percentageField,
  })
  .superRefine(requireCompleteLevel('Class 12', { board: 'Board', school: 'School name' }));

const graduationEducationSchema = z
  .object({
    degree: optionalText(100),
    college: optionalText(150),
    university: optionalText(150),
    passingYear: passingYearField.optional().or(z.literal('')),
    percentage: percentageField,
  })
  .superRefine(requireCompleteLevel('Graduation', { degree: 'Degree', college: 'College name' }));

const educationSchema = z.object({
  class10: class10EducationSchema.optional(),
  class12: class12EducationSchema.optional(),
  graduation: graduationEducationSchema.optional(),
});

export const suggestionsQuerySchema = z.object({
  q: z.string().max(100).optional().default(''),
});

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
  education: educationSchema.optional(),
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
    // Skippable during setup — adding it later earns score.
    education: educationSchema.optional(),
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
  salaryBand: z.string().max(50).optional(),
  joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Joining date must be YYYY-MM-DD').optional().or(z.literal('')),
  exitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Exit date must be YYYY-MM-DD').optional().or(z.literal('')),
  isPresent: z.preprocess((val) => val === true || val === 'true', z.boolean().optional()),
  duration: z.string().max(100).optional(),
  companyEmail: z.string().email().optional().or(z.literal('')),
  hrEmail: z.string().email().optional().or(z.literal('')),
  managerEmail: z.string().email().optional().or(z.literal('')),
  managerName: z.string().max(100).optional(),
  employeeCode: z.string().max(50).optional(),
  department: z.string().max(100).optional(),
  workLocation: z.string().max(100).optional(),
  uanNumber: z.string().regex(/^\d{12}$/, 'UAN must be 12 digits').optional().or(z.literal('')),
  pfNumber: z.string().max(30).optional(),
  esiNumber: z.string().max(20).optional(),
  companyPan: z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/i, 'Invalid company PAN').optional().or(z.literal('')),
  companyCin: z.string().max(25).optional(),
  companyGst: z.string().max(20).optional(),
  lastDrawnSalary: z.string().max(30).optional(),
  description: z.string().max(2000).optional(),
}).superRefine((data, ctx) => {
  if (!data.isPresent && data.joiningDate && data.exitDate && data.exitDate < data.joiningDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Exit date cannot be before joining date',
      path: ['exitDate'],
    });
  }
});

export const jobVerificationRequestSchema = z.object({
  hrEmail: z.string().email().optional(),
  managerEmail: z.string().email().optional(),
  hrName: z.string().optional(),
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

export const smtpSettingsSchema = z.object({
  host: z.string().trim().max(200).optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  secure: z.boolean().optional(),
  username: z.string().trim().max(200).optional(),
  // Write-only; empty string / omitted keeps the stored password.
  password: z.string().max(300).optional(),
  senderName: z.string().trim().max(120).optional(),
  senderEmail: z.string().trim().email('Valid sender email is required').max(200).optional().or(z.literal('')),
});

export const smtpTestSchema = z.object({
  to: z.string().trim().email('Valid recipient email is required').max(200).optional(),
});
