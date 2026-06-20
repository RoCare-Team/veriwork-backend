import { z } from 'zod';

export const inviteEmployeeSchema = z.object({
  employeeName: z.string().min(1, 'Employee name is required'),
  employeeEmail: z.string().email().optional(),
  employeeMobile: z.string().min(10).optional(),
  employeePagerlookId: z.string().min(3).optional(),
  department: z.string().min(1),
  designation: z.string().min(1),
}).superRefine((data, ctx) => {
  if (!data.employeeEmail && !data.employeeMobile && !data.employeePagerlookId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide at least one employee identifier (email, mobile, or PagerLook ID)',
      path: ['employeeEmail'],
    });
  }
});

export const companyAccessRequestSchema = z.object({
  employeeId: z.string().min(1),
  requestType: z.enum([
    'profile_access',
    'background_check',
    'verification_data',
    'full_profile_access',
  ]).default('profile_access'),
  message: z.string().max(500).optional(),
});

export const createVerificationRequestSchema = z.object({
  employeeId: z.string().min(1),
  jobExperienceId: z.string().min(1),
  targetCompanyId: z.string().optional(),
  hrEmail: z.string().email().optional(),
  managerEmail: z.string().email().optional(),
  hrName: z.string().optional(),
});

export const approveVerificationRequestSchema = z.object({
  workedHere: z.boolean().optional(),
  designation: z.string().optional(),
  joiningDate: z.string().optional(),
  exitDate: z.string().optional(),
  duration: z.string().optional(),
  feedback: z.string().max(1000).optional(),
  hrFeedback: z.string().max(1000).optional(),
  rehireEligible: z.boolean().nullable().optional(),
  verificationNotes: z.string().max(1000).optional(),
  employmentType: z.string().optional(),
  employmentStatus: z.string().optional(),
  notes: z.string().max(500).optional(),
});

export const reviewHrResponseSchema = z.object({
  approved: z.boolean(),
  notes: z.string().max(500).optional(),
});

export const emailVerificationCompleteSchema = z.object({
  verified: z.boolean().optional(),
  useDocuments: z.boolean().optional(),
  notes: z.string().max(500).optional(),
});

export const revokeAccessSchema = z.object({
  requestType: z.enum([
    'profile_access',
    'background_check',
    'verification_data',
    'full_profile_access',
  ]).optional(),
});

export const auditLogsQuerySchema = z.object({
  action: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const assignEmployeeOnboardingSchema = z.object({
  department: z.string().min(1).optional(),
  designation: z.string().min(1).optional(),
  reportingManagerId: z.string().optional(),
});
