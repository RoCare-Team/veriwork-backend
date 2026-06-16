import { z } from 'zod';

export const basicInfoSchema = z.object({
  companyName: z.string().min(1).optional(),
  industry: z.string().optional(),
  companySize: z.string().optional(),
  workEmail: z.string().email().optional(),
  contactName: z.string().optional(),
  phone: z.string().optional(),
  country: z.string().optional(),
  city: z.string().optional(),
});

export const registrationSchema = z.object({
  brn: z.string().optional(),
  taxId: z.string().optional(),
});

export const submitOnboardingSchema = z.object({
  certified: z.boolean(),
});

export const updateJoinRequestSchema = z.object({
  status: z.enum(['approved', 'rejected']),
});

export const createJoinRequestSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  department: z.string().optional(),
  joiningDate: z.string().optional(),
  salaryBand: z.string().optional(),
  candidateUserId: z.string().optional(),
});

export const createQrSchema = z.object({
  label: z.string().min(1),
});

export const teamEmployeesQuerySchema = z.object({
  department: z.string().optional(),
  search: z.string().optional(),
  employmentStatus: z.enum(['active', 'on_leave', 'terminated', 'probation']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const accessRequestsQuerySchema = z.object({
  status: z.enum(['all', 'pending', 'approved', 'rejected', 'accepted']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const createAccessRequestSchema = z.object({
  employeeUserId: z.string().min(1),
  requestType: z.enum(['profile_access', 'background_check', 'verification_data']).optional(),
  message: z.string().max(500).optional(),
});
