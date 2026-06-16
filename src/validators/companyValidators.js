import { z } from 'zod';

export const inviteEmployeeSchema = z.object({
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
  requestType: z.enum(['profile_access', 'background_check', 'verification_data']).default('profile_access'),
});

export const createVerificationRequestSchema = z.object({
  employeeId: z.string().min(1),
  jobExperienceId: z.string().min(1),
  hrEmail: z.string().email().optional(),
  hrName: z.string().optional(),
});

export const emailVerificationCompleteSchema = z.object({
  verified: z.boolean(),
  notes: z.string().max(500).optional(),
});

export const auditLogsQuerySchema = z.object({
  action: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
