import { z } from 'zod';
import { MAX_HR_CONTACTS } from './employeeValidators.js';

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

export const aadhaarRequestsQuerySchema = z.object({
  status: z.enum(['all', 'pending', 'approved', 'rejected']).optional().default('pending'),
  q: z.string().max(100).optional(),
});

export const reviewAadhaarSchema = z
  .object({
    status: z.enum(['approved', 'rejected']),
    reason: z.string().trim().max(500).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.status === 'rejected' && !data.reason?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Tell the employee why their Aadhaar was rejected',
        path: ['reason'],
      });
    }
  });

// Support desk view over every verification request, whoever started it.
export const adminVerificationRequestsQuerySchema = z.object({
  status: z
    .enum(['all', 'open', 'pending', 'in_review', 'hr_responded', 'verified', 'rejected', 'expired'])
    .optional()
    .default('all'),
  q: z.string().max(100).optional(),
});

// Support resend — the admin may fix or extend the HR contact list first.
export const adminResendVerificationSchema = z.object({
  hrContacts: z
    .array(z.string().email('Enter a valid HR email address'))
    .max(MAX_HR_CONTACTS, `At most ${MAX_HR_CONTACTS} HR contacts can be added`)
    .optional(),
  hrName: z.string().max(120).optional(),
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
