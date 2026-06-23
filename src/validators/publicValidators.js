import { z } from 'zod';

export const publicProfileAccessRequestSchema = z.object({
  requesterName: z.string().trim().min(2, 'Name is required').max(120),
  requesterEmail: z.string().trim().email('Valid email is required').max(200),
  reason: z.string().trim().min(10, 'Please explain why you need profile access').max(1000),
});

console.log('Public validators loaded successfully');

export const publicVerificationRespondSchema = z.object({
  workedHere: z.boolean(),
  designation: z.string().optional(),
  joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  exitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  duration: z.string().optional(),
  feedback: z.string().max(1000).optional(),
  rehireEligible: z.boolean().nullable().optional(),
  verificationNotes: z.string().max(1000).optional(),
  employmentType: z.string().optional(),
  employeeCode: z.string().max(50).optional(),
  department: z.string().max(100).optional(),
  uanNumber: z.string().max(12).optional(),
  pfNumber: z.string().max(30).optional(),
  esiNumber: z.string().max(20).optional(),
});
