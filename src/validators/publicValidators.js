import { z } from 'zod';

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
