import { z } from 'zod';

export const acceptCompanyUserInviteSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

// Mirrors the Invite Employee form: mobile identifies them, email is optional
// (the link is handed back for an immediate redirect rather than only emailed).
export const qrJoinRequestSchema = z.object({
  name: z.string().trim().min(2, 'Your name is required').max(120),
  phone: z.string().trim().min(10, 'A 10-digit mobile number is required').max(20),
  email: z.string().trim().email('Valid email is required').max(200).optional().or(z.literal('')),
  role: z.string().trim().max(120).optional(),
  department: z.string().trim().max(100).optional(),
  joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
});

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
  // Salary the verifier confirms, plus the two explicit decisions. These MUST
  // be declared here — Zod strips unknown keys, so omitting them silently drops
  // the verifier's answers before the service ever sees them.
  monthlyInHandSalary: z.string().max(30).optional(),
  yearlyPackage: z.string().max(30).optional(),
  salaryVerificationStatus: z.enum(['verified', 'unverified', '']).optional(),
  employmentVerificationStatus: z.enum(['verified', 'unverified', '']).optional(),
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

// "Book a demo" from the landing page — a lead, not an account, so only the
// details a sales call actually needs are required.
export const demoRequestSchema = z.object({
  name: z.string().trim().min(2, 'Your name is required').max(120),
  email: z.string().trim().email('Valid email is required').max(200),
  phone: z
    .string()
    .trim()
    .refine((v) => v.replace(/\D/g, '').length >= 10, 'A 10-digit mobile number is required'),
  company: z.string().trim().max(150).optional().or(z.literal('')),
  teamSize: z.string().trim().max(40).optional().or(z.literal('')),
  message: z.string().trim().max(1000).optional().or(z.literal('')),
});
