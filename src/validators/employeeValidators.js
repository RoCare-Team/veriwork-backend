import { z } from 'zod';

export const updateProfileSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.string().optional(),
  company: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  skills: z.array(z.string()).optional(),
});

export const aadhaarVerifySchema = z.object({
  method: z.enum(['digilocker', 'otp']).default('digilocker'),
  aadhaarNumber: z.string().optional(),
  otp: z.string().optional(),
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
