import { z } from 'zod';

export const inviteEmployeeSchema = z.object({
  employeeName: z.string().min(1, 'Employee name is required'),
  employeeEmail: z.string().email().optional(),
  employeeMobile: z.string().min(10).optional(),
  employeePagerlookId: z.string().min(3).optional(),
  department: z.string().min(1),
  designation: z.string().min(1),
  // No identifier required — a link-only invite (name + role) generates a
  // shareable registration link the company can copy and send to a new employee.
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
  employeeCode: z.string().max(50).optional(),
  department: z.string().max(100).optional(),
  workLocation: z.string().max(100).optional(),
  uanNumber: z.string().max(12).optional(),
  pfNumber: z.string().max(30).optional(),
  esiNumber: z.string().max(20).optional(),
  companyPan: z.string().max(10).optional(),
  companyCin: z.string().max(25).optional(),
  companyGst: z.string().max(20).optional(),
  lastDrawnSalary: z.string().max(30).optional(),
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
