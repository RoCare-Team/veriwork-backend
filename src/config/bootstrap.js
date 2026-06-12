import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { env } from '../config/env.js';

const ADMIN_EMAIL = 'admin@veriwork.com';
const ADMIN_PASSWORD = 'Admin@VeriWork123';
const SALT_ROUNDS = 10;

export async function ensurePlatformAdmin() {
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, SALT_ROUNDS);
  const existing = await User.findOne({ email: ADMIN_EMAIL });

  if (existing) {
    const needsUpdate =
      existing.role !== 'platform_admin'
      || !existing.passwordHash
      || env.isDev;

    if (needsUpdate) {
      existing.role = 'platform_admin';
      existing.passwordHash = passwordHash;
      existing.isActive = true;
      await existing.save();
      console.log(`Platform admin ready: ${ADMIN_EMAIL}`);
    }
    return;
  }

  await User.create({
    email: ADMIN_EMAIL,
    passwordHash,
    role: 'platform_admin',
  });

  console.log(`Platform admin created: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
}
