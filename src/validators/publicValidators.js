import { z } from 'zod';

export const publicProfileAccessRequestSchema = z.object({
  requesterName: z.string().trim().min(2, 'Name is required').max(120),
  requesterEmail: z.string().trim().email('Valid email is required').max(200),
  reason: z.string().trim().min(10, 'Please explain why you need profile access').max(1000),
});

export const publicVerificationRespondSchema = z.object({
  workedHere: z.boolean(),
  designation: z.string().optional(),
  joiningDate: z.string().optional(),
  exitDate: z.string().optional(),
  duration: z.string().optional(),
  feedback: z.string().max(1000).optional(),
  rehireEligible: z.boolean().nullable().optional(),
  verificationNotes: z.string().max(1000).optional(),
  employmentType: z.string().optional(),
});
