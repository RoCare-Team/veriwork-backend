import bcrypt from 'bcryptjs';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { User } from '../models/User.js';

const ADMIN_EMAIL = 'admin@veriwork.com';
const ADMIN_PASSWORD = 'Admin@VeriWork123';
const SALT_ROUNDS = 10;

async function ensureAdmin() {
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

  console.log('Password:', ADMIN_PASSWORD);
  console.log('Login: POST /api/auth/admin/login');
  await disconnectDatabase();
}

ensureAdmin().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
