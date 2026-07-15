import { z } from 'zod';

export const publicProfileAccessRequestSchema = z.object({
  requesterName: z.string().trim().min(2, 'Name is required').max(120),
  requesterEmail: z.string().trim().email('Valid email is required').max(200),
  reason: z.string().trim().min(10, 'Please explain why you need profile access').max(1000),
});

console.log('Public validators loaded successfully');

export const publicVerificationRespondSchema = z.object({
  workedHere: z.boolean(),
  designation: z.string().max(150).optional(),
  joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  exitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  duration: z.string().max(60).optional(),
  feedback: z.string().max(1000).optional(),
  rehireEligible: z.boolean().nullable().optional(),
  verificationNotes: z.string().max(1000).optional(),
  employmentType: z.string().max(60).optional(),
  employeeCode: z.string().max(50).optional(),
  department: z.string().max(100).optional(),
  uanNumber: z.string().max(12).optional(),
  pfNumber: z.string().max(30).optional(),
  esiNumber: z.string().max(20).optional(),
  // Structured HR verification form
  reportingManager: z.string().max(120).optional(),
  performanceRating: z.enum(['excellent', 'good', 'average', 'below_average', 'poor', '']).optional(),
  behaviorRemarks: z.string().max(1000).optional(),
  disciplinaryIssues: z.boolean().nullable().optional(),
  disciplinaryDetails: z.string().max(1000).optional(),
  recommendation: z.enum(['strongly_recommend', 'recommend', 'neutral', 'not_recommend', '']).optional(),
  hrRemarks: z.string().max(1000).optional(),
  supportingDocumentUrl: z.string().max(500).optional(),
  supportingDocumentName: z.string().max(200).optional(),
  // Verifier identity + declaration
  verifierName: z.string().max(120).optional(),
  verifierDesignation: z.string().max(120).optional(),
  verifierEmail: z.string().email('Valid verifier email is required').max(200).optional().or(z.literal('')),
  verifierPhone: z.string().max(20).optional(),
  declarationAccepted: z.boolean().optional(),
});
