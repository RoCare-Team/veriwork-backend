import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { Company } from '../models/Company.js';
import { CompanyOnboarding } from '../models/CompanyOnboarding.js';
import { env } from '../config/env.js';

const SALT_ROUNDS = 10;

// Dev-only fallback so a fresh local checkout still boots with a usable admin.
// Production must supply ADMIN_EMAIL / ADMIN_PASSWORD explicitly.
const DEV_ADMIN_EMAIL = 'admin@pagerlook.local';
const DEV_ADMIN_PASSWORD = 'Admin@Local123';

function resolveAdminCredentials() {
  const email = env.admin.email.trim().toLowerCase();
  const password = env.admin.password;

  if (email && password) return { email, password, fromEnv: true };

  if (env.isDev) {
    return { email: DEV_ADMIN_EMAIL, password: DEV_ADMIN_PASSWORD, fromEnv: false };
  }

  return null;
}

export async function ensurePlatformAdmin() {
  const creds = resolveAdminCredentials();

  if (!creds) {
    console.warn(
      'Platform admin seed skipped: set ADMIN_EMAIL and ADMIN_PASSWORD to provision the admin console.',
    );
    return;
  }

  const { email, password, fromEnv } = creds;
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const existing = await User.findOne({ email });

  if (existing) {
    /*
     * Only repair what's broken. Rewriting the hash on every boot would undo
     * any password the admin set through the console, so the password is
     * reseeded solely when the account has none (or in dev, where the
     * fallback credentials are meant to stay predictable).
     */
    const missingPassword = !existing.passwordHash;
    const needsUpdate = existing.role !== 'platform_admin' || missingPassword || !existing.isActive;

    if (needsUpdate || (env.isDev && !fromEnv)) {
      existing.role = 'platform_admin';
      existing.isActive = true;
      if (missingPassword || (env.isDev && !fromEnv)) existing.passwordHash = passwordHash;
      await existing.save();
      console.log(`Platform admin ready: ${email}`);
    }
    return;
  }

  await User.create({ email, passwordHash, role: 'platform_admin' });

  // Never log the password when it came from the environment.
  console.log(
    fromEnv
      ? `Platform admin created: ${email}`
      : `Platform admin created (dev fallback): ${email} / ${password}`,
  );
}

// Hardcoded employer demo login (app-store review / sales demos). Its company is
// pre-approved so the login lands straight on the dashboard. The password is
// reset on every boot so the demo credentials always work.
const DEMO_EMPLOYER_EMAIL = 'demo@pagerlook.com';
const DEMO_EMPLOYER_PASSWORD = 'pagerlook@321';
const DEMO_COMPANY_NAME = 'PagerLook Demo';

export async function ensureDemoEmployer() {
  const passwordHash = await bcrypt.hash(DEMO_EMPLOYER_PASSWORD, SALT_ROUNDS);
  let user = await User.findOne({ email: DEMO_EMPLOYER_EMAIL });

  if (user && user.role !== 'enterprise_admin') {
    // Never turn someone else's account into the demo.
    console.warn(`Demo employer skipped: ${DEMO_EMPLOYER_EMAIL} is already a ${user.role} account.`);
    return;
  }

  let company = user?.companyId ? await Company.findById(user.companyId) : null;
  if (!company) {
    company = await Company.create({
      name: DEMO_COMPANY_NAME,
      workEmail: DEMO_EMPLOYER_EMAIL,
      contactName: 'PagerLook Demo',
      country: 'India',
    });
  }
  company.isVerified = true;
  company.onboardingComplete = true;
  await company.save();

  await CompanyOnboarding.updateOne(
    { companyId: company._id },
    {
      $set: { status: 'approved', rejectionReason: '', reviewedAt: new Date() },
      $setOnInsert: {
        basicInfo: { companyName: company.name, workEmail: DEMO_EMPLOYER_EMAIL, country: 'India' },
      },
    },
    { upsert: true },
  );

  if (!user) {
    user = await User.create({
      email: DEMO_EMPLOYER_EMAIL,
      passwordHash,
      role: 'enterprise_admin',
      companyRole: 'owner',
      companyId: company._id,
    });
  } else {
    user.passwordHash = passwordHash;
    user.companyId = company._id;
    user.companyRole = user.companyRole || 'owner';
    user.isActive = true;
    await user.save();
  }

  console.log(`Demo employer ready: ${DEMO_EMPLOYER_EMAIL}`);
}
