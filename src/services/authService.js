import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { Company } from '../models/Company.js';
import { CompanyOnboarding } from '../models/CompanyOnboarding.js';
import { ApiError } from '../utils/ApiError.js';
import { sendOtp, verifyOtp } from './otpService.js';
import {
  buildAuthEmployeePayload,
  getJobsForUser,
  getOrCreateEmployeeUser,
  getOrCreateEmployeeByGoogle,
} from './employeeProfileService.js';
import { RefreshToken } from '../models/RefreshToken.js';
import {
  createRefreshToken,
  revokeAllUserTokens,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
} from './tokenService.js';
import { normalizePhone } from '../utils/idGenerators.js';
import { getEnterpriseHomeRoute, getCompanyApprovalStatus } from '../utils/companyApproval.js';
import { verifyGoogleIdToken } from './googleAuthService.js';

const SALT_ROUNDS = 10;

async function buildEmployeeAuthResponse(user, profile) {
  const jobs = await getJobsForUser(user._id);
  const accessToken = signAccessToken(user);
  const refreshToken = await createRefreshToken(user._id);

  return {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    ...buildAuthEmployeePayload(user, profile, jobs),
  };
}

export async function employeeSendOtp(phone) {
  return sendOtp(phone);
}

export async function employeeVerifyOtp(phone, code) {
  const normalized = await verifyOtp(phone, code);
  const { user, profile } = await getOrCreateEmployeeUser(normalized);
  return buildEmployeeAuthResponse(user, profile);
}

export async function employeeGoogleLogin(idToken) {
  const googleUser = await verifyGoogleIdToken(idToken);

  if (!googleUser.emailVerified) {
    throw ApiError.unauthorized('Google email is not verified');
  }

  const { user, profile } = await getOrCreateEmployeeByGoogle(googleUser);
  return buildEmployeeAuthResponse(user, profile);
}

export async function changePassword(userId, currentPassword, newPassword) {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('User not found');
  if (!user.passwordHash) {
    throw ApiError.badRequest(
      'Your account signs in with OTP or Google, so there is no password to change.',
    );
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) throw ApiError.unauthorized('Current password is incorrect');

  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    throw ApiError.badRequest('New password must be different from the current password');
  }

  user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await user.save();

  return { message: 'Password updated successfully' };
}

export async function enterpriseLogin(email, password) {
  const user = await User.findOne({ email: email.toLowerCase(), role: 'enterprise_admin' });
  if (!user || !user.passwordHash) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  const company = user.companyId ? await Company.findById(user.companyId) : null;
  const onboarding = company
    ? await CompanyOnboarding.findOne({ companyId: company._id })
    : null;

  const accessToken = signAccessToken(user);
  const refreshToken = await createRefreshToken(user._id);

  return {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    user: {
      id: user._id,
      email: user.email,
      role: user.role,
      companyId: user.companyId,
    },
    company: company
      ? {
          id: company._id,
          name: company.name,
          workEmail: company.workEmail,
          onboardingComplete: company.onboardingComplete,
          isVerified: company.isVerified,
          approvalStatus: onboarding?.status || 'draft',
          rejectionReason: onboarding?.rejectionReason || '',
        }
      : null,
    homeRoute: getEnterpriseHomeRoute(onboarding, company),
  };
}

export async function platformAdminLogin(email, password) {
  const normalizedEmail = email.toLowerCase();
  const user = await User.findOne({ email: normalizedEmail });

  if (!user || !user.passwordHash) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  if (user.role !== 'platform_admin') {
    throw ApiError.forbidden(
      'This account is not a platform admin. Use /api/auth/enterprise/login for company accounts.',
    );
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  const accessToken = signAccessToken(user);
  const refreshToken = await createRefreshToken(user._id);

  return {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    user: {
      id: user._id,
      email: user.email,
      role: user.role,
    },
    homeRoute: '/admin/dashboard',
  };
}

export async function enterpriseRegister({
  email,
  password,
  companyLegalName,
  industry,
  companySize,
  workEmail,
  contactName,
  phone,
  country = 'India',
  city = '',
}) {
  const normalizedEmail = email.toLowerCase();
  const normalizedWorkEmail = workEmail.toLowerCase();
  const normalizedPhone = normalizePhone(phone);

  const existingUser = await User.findOne({ email: normalizedEmail });
  if (existingUser) {
    throw ApiError.conflict('An account with this admin email already exists');
  }

  const existingCompany = await Company.findOne({ workEmail: normalizedWorkEmail });
  if (existingCompany) {
    throw ApiError.conflict('A company with this official work email already exists');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const company = await Company.create({
    name: companyLegalName,
    industry,
    companySize,
    workEmail: normalizedWorkEmail,
    contactName,
    phone: normalizedPhone,
    country,
    city: city || '',
  });

  const user = await User.create({
    email: normalizedEmail,
    passwordHash,
    role: 'enterprise_admin',
    // Whoever registers the company owns it.
    companyRole: 'owner',
    companyId: company._id,
  });

  await CompanyOnboarding.create({
    companyId: company._id,
    basicInfo: {
      companyName: companyLegalName,
      industry,
      companySize,
      workEmail: normalizedWorkEmail,
      contactName,
      phone: normalizedPhone,
      country,
      city: city || '',
    },
  });

  const accessToken = signAccessToken(user);
  const refreshToken = await createRefreshToken(user._id);

  return {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    user: {
      id: user._id,
      email: user.email,
      role: user.role,
      companyId: company._id,
    },
    company: {
      id: company._id,
      name: company.name,
      industry: company.industry,
      companySize: company.companySize,
      workEmail: company.workEmail,
      contactName: company.contactName,
      phone: company.phone,
      country: company.country,
      city: company.city,
      onboardingComplete: false,
      isVerified: false,
      approvalStatus: 'draft',
    },
    homeRoute: '/enterprise/verify',
  };
}

export async function refreshTokens(refreshToken) {
  const newRefreshToken = await rotateRefreshToken(refreshToken);
  const stored = await RefreshToken.findOne({ token: newRefreshToken });
  const user = await User.findById(stored.userId);
  if (!user) throw ApiError.unauthorized('User not found');

  const accessToken = signAccessToken(user);

  return {
    accessToken,
    refreshToken: newRefreshToken,
    tokenType: 'Bearer',
  };
}

export async function logout(refreshToken, userId) {
  if (refreshToken) {
    await revokeRefreshToken(refreshToken);
  } else if (userId) {
    await revokeAllUserTokens(userId);
  }
  return { message: 'Logged out successfully' };
}
