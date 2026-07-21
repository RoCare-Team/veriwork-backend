import { z } from 'zod';

const phoneField = z
  .string({ required_error: 'Phone number is required' })
  .min(1, 'Phone number is required')
  .refine((val) => val.replace(/\D/g, '').length >= 10, {
    message: 'Phone number must be at least 10 digits',
  });

export const phoneSchema = z.object({
  phone: phoneField,
});

export const otpVerifySchema = z.object({
  phone: z.string().min(10),
  code: z.string().length(6, 'OTP must be 6 digits'),
});

export const employeeGoogleSchema = z.object({
  idToken: z.string().min(1, 'Google ID token is required'),
});

export const enterpriseLoginSchema = z.object({
  email: z.string({ required_error: 'Email is required' }).email('Invalid email address'),
  password: z.string({ required_error: 'Password is required' }).min(1, 'Password is required'),
});

export const platformAdminLoginSchema = z.object({
  email: z.string({ required_error: 'Email is required' }).email('Invalid email address'),
  password: z.string({ required_error: 'Password is required' }).min(1, 'Password is required'),
});

export const enterpriseRegisterSchema = z
  .object({
    // Account credentials
    email: z
      .string({ required_error: 'Admin email is required' })
      .min(1, 'Admin email is required')
      .email('Invalid admin email address'),
    password: z
      .string({ required_error: 'Password is required' })
      .min(8, 'Password must be at least 8 characters'),
    confirmPassword: z
      .string({ required_error: 'Confirm password is required' })
      .min(1, 'Confirm password is required'),

    // Company details
    companyLegalName: z
      .string({ required_error: 'Company legal name is required' })
      .min(1, 'Company legal name is required')
      .max(200, 'Company legal name is too long'),
    industry: z
      .string({ required_error: 'Industry is required' })
      .min(1, 'Industry is required'),
    companySize: z
      .string({ required_error: 'Company size is required' })
      .min(1, 'Company size is required'),
    workEmail: z
      .string({ required_error: 'Official work email is required' })
      .min(1, 'Official work email is required')
      .email('Invalid work email address'),

    // Contact information
    contactName: z
      .string({ required_error: 'Authorized contact person is required' })
      .min(1, 'Authorized contact person is required')
      .max(100, 'Contact name is too long'),
    phone: phoneField,
    country: z
      .string({ required_error: 'Country is required' })
      .min(1, 'Country is required')
      .default('India'),
    city: z.string().max(100, 'City name is too long').optional().or(z.literal('')),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

export const logoutSchema = z.object({
  refreshToken: z.string().optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

export const forgotPasswordSchema = z.object({
  email: z.string({ required_error: 'Email is required' }).email('Invalid email address'),
});

export const resetPasswordSchema = z.object({
  token: z.string({ required_error: 'Reset token is required' }).min(1, 'Reset token is required'),
  newPassword: z.string({ required_error: 'Password is required' }).min(8, 'New password must be at least 8 characters'),
});