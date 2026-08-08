import bcrypt from 'bcryptjs';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { User } from '../models/User.js';

// Credentials come from the environment so they aren't published in source.
// Run as: ADMIN_EMAIL=... ADMIN_PASSWORD=... node src/scripts/ensureAdmin.js
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SALT_ROUNDS = 10;

async function ensureAdmin() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD before running this script');
  }

  await connectDatabase();

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, SALT_ROUNDS);
  const existing = await User.findOne({ email: ADMIN_EMAIL });

  if (existing) {
    existing.role = 'platform_admin';
    existing.passwordHash = passwordHash;
    existing.isActive = true;
    await existing.save();
    console.log('Platform admin updated:', ADMIN_EMAIL);
  } else {
    await User.create({
      email: ADMIN_EMAIL,
      passwordHash,
      role: 'platform_admin',
    });
    console.log('Platform admin created:', ADMIN_EMAIL);
  }

  console.log('Login: POST /api/auth/admin/login');
  await disconnectDatabase();
}

ensureAdmin().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
