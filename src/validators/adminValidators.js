import { z } from 'zod';

export const adminEmployeesQuerySchema = z.object({
  q: z.string().max(100).optional(),
  status: z.enum(['all', 'complete', 'incomplete', 'verified']).optional().default('all'),
});

export const reviewCompanySchema = z.object({
  status: z.enum(['approved', 'rejected']),
  reason: z.string().optional(),
}).refine(
  (data) => data.status !== 'rejected' || (data.reason && data.reason.trim().length > 0),
  { message: 'Rejection reason is required', path: ['reason'] },
);
