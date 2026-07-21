import { z } from 'zod';

export const adminEmployeesQuerySchema = z.object({
  q: z.string().max(100).optional(),
  status: z.enum(['all', 'complete', 'incomplete', 'verified']).optional().default('all'),
});

export const reviewDocumentSchema = z
  .object({
    documentKey: z.string().trim().min(1, 'Document key is required'),
    status: z.enum(['approved', 'rejected']),
    reason: z.string().trim().max(500).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.status === 'rejected' && !data.reason?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Tell the company what is wrong with this document',
        path: ['reason'],
      });
    }
  });

export const onboardingMessageSchema = z.object({
  body: z.string().trim().min(1, 'Message cannot be empty').max(2000),
});

export const reviewCompanySchema = z.object({
  status: z.enum(['approved', 'rejected']),
  reason: z.string().optional(),
}).refine(
  (data) => data.status !== 'rejected' || (data.reason && data.reason.trim().length > 0),
  { message: 'Rejection reason is required', path: ['reason'] },
);
