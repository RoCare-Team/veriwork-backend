import bcrypt from 'bcryptjs';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { User } from '../models/User.js';
import { Company } from '../models/Company.js';
import { CompanyOnboarding } from '../models/CompanyOnboarding.js';
import { EmployeeProfile } from '../models/EmployeeProfile.js';
import { JobExperience } from '../models/JobExperience.js';
import { JoinRequest } from '../models/JoinRequest.js';
import { ActivityLog } from '../models/ActivityLog.js';
import { VaultItem } from '../models/VaultItem.js';
import { QrOnboarding } from '../models/QrOnboarding.js';
import { generatePublicSlug, generateVeriworkId } from '../utils/idGenerators.js';
import { calculateEmployeeScore } from '../services/scoreService.js';

const SALT_ROUNDS = 10;

async function clearCollections() {
  await Promise.all([
    User.deleteMany({}),
    Company.deleteMany({}),
    CompanyOnboarding.deleteMany({}),
    EmployeeProfile.deleteMany({}),
    JobExperience.deleteMany({}),
    JoinRequest.deleteMany({}),
    ActivityLog.deleteMany({}),
    VaultItem.deleteMany({}),
    QrOnboarding.deleteMany({}),
  ]);
}

async function seed() {
  await connectDatabase();
  await clearCollections();

  const passwordHash = await bcrypt.hash('VeriWork@123', SALT_ROUNDS);
  const adminPasswordHash = await bcrypt.hash('Admin@VeriWork123', SALT_ROUNDS);

  // Platform admin
  await User.create({
    email: 'admin@veriwork.com',
    passwordHash: adminPasswordHash,
    role: 'platform_admin',
  });

  // Enterprise company (pre-approved)
  const company = await Company.create({
    name: 'TechNova Solutions',
    industry: 'Technology',
    companySize: '100-500',
    workEmail: 'hr@technova.com',
    contactName: 'Priya Sharma',
    phone: '+919876543210',
    country: 'India',
    city: 'Bangalore',
    brn: 'BRN-2024-001',
    taxId: 'GSTIN29AABCT1234Z1',
    isVerified: true,
    onboardingComplete: true,
  });

  const enterpriseUser = await User.create({
    email: 'hr@technova.com',
    passwordHash,
    role: 'enterprise_admin',
    companyId: company._id,
  });

  await CompanyOnboarding.create({
    companyId: company._id,
    basicInfo: {
      companyName: company.name,
      industry: company.industry,
      companySize: company.companySize,
      workEmail: company.workEmail,
      contactName: company.contactName,
      phone: company.phone,
      country: company.country,
      city: company.city,
    },
    registration: { brn: company.brn, taxId: company.taxId },
    certified: true,
    status: 'approved',
    reviewedAt: new Date(),
  });

  // Pending company (for admin approval testing)
  const pendingCompany = await Company.create({
    name: 'Startup Labs Pvt Ltd',
    industry: 'Technology',
    companySize: '11-50',
    workEmail: 'hr@startuplabs.com',
    contactName: 'Amit Verma',
    phone: '+919988877766',
    country: 'India',
    city: 'Delhi',
    brn: 'BRN-PENDING-001',
    taxId: 'GSTIN29STARTUP1',
  });

  await User.create({
    email: 'admin@startuplabs.com',
    passwordHash,
    role: 'enterprise_admin',
    companyId: pendingCompany._id,
  });

  await CompanyOnboarding.create({
    companyId: pendingCompany._id,
    basicInfo: {
      companyName: pendingCompany.name,
      industry: pendingCompany.industry,
      companySize: pendingCompany.companySize,
      workEmail: pendingCompany.workEmail,
      contactName: pendingCompany.contactName,
      phone: pendingCompany.phone,
      country: pendingCompany.country,
      city: pendingCompany.city,
    },
    registration: { brn: pendingCompany.brn, taxId: pendingCompany.taxId },
    certified: true,
    status: 'submitted',
  });

  // Employee 1 — fully verified, high score
  const user1 = await User.create({ phone: '+919888877766', role: 'employee' });
  const profile1 = await EmployeeProfile.create({
    userId: user1._id,
    phone: '+919888877766',
    name: 'Rahul Mehta',
    role: 'Senior Software Engineer',
    company: 'Infosys',
    email: 'rahul.mehta@email.com',
    skills: ['Node.js', 'React', 'MongoDB'],
    profileSetupComplete: true,
    aadhaarVerified: true,
    biometricVerified: true,
    digilockerUsed: true,
    endorsements: 5,
    veriworkId: generateVeriworkId(),
    publicSlug: generatePublicSlug(user1._id),
  });

  const jobs1 = await JobExperience.insertMany([
    {
      userId: user1._id,
      title: 'Senior Software Engineer',
      company: 'Infosys',
      employmentType: 'Full-time',
      joiningDate: '2021-03-01',
      isPresent: true,
      status: 'verified',
    },
    {
      userId: user1._id,
      title: 'Software Engineer',
      company: 'TCS',
      employmentType: 'Full-time',
      joiningDate: '2018-06-01',
      exitDate: '2021-02-28',
      status: 'verified',
    },
  ]);

  profile1.scoreCached = calculateEmployeeScore(profile1, jobs1);
  await profile1.save();

  // Employee 2 — partial verification, lower score
  const user2 = await User.create({ phone: '+919777766655', role: 'employee' });
  const profile2 = await EmployeeProfile.create({
    userId: user2._id,
    phone: '+919777766655',
    name: 'Anita Desai',
    role: 'Product Manager',
    company: 'StartupXYZ',
    profileSetupComplete: true,
    aadhaarVerified: true,
    biometricVerified: false,
    veriworkId: generateVeriworkId(),
    publicSlug: generatePublicSlug(user2._id),
  });

  const jobs2 = await JobExperience.create({
    userId: user2._id,
    title: 'Product Manager',
    company: 'StartupXYZ',
    employmentType: 'Full-time',
    joiningDate: '2023-01-15',
    isPresent: true,
    status: 'in_process',
  });

  profile2.scoreCached = calculateEmployeeScore(profile2, [jobs2]);
  await profile2.save();

  // Activity logs for employee 1
  await ActivityLog.insertMany([
    {
      userId: user1._id,
      type: 'consent_request',
      title: 'Background check consent',
      message: 'TechNova Solutions requested access to your employment records',
      company: 'TechNova Solutions',
      status: 'pending',
    },
    {
      userId: user1._id,
      type: 'access_request',
      title: 'Profile access request',
      message: 'HR at TechNova wants to view your VeriScore',
      company: 'TechNova Solutions',
      status: 'pending',
    },
  ]);

  // Vault items
  await VaultItem.insertMany([
    { userId: user1._id, category: 'identity', name: 'Aadhaar Card', size: '245 KB', status: 'verified' },
    { userId: user1._id, category: 'education', name: 'B.Tech Degree', size: '1.2 MB', status: 'verified' },
  ]);

  // Join requests (4 total)
  await JoinRequest.insertMany([
    {
      companyId: company._id,
      candidateUserId: user1._id,
      name: 'Rahul Mehta',
      role: 'Senior Software Engineer',
      department: 'Engineering',
      employeeScore: profile1.scoreCached,
      joiningDate: '2026-04-01',
      salaryBand: '15-20 LPA',
      status: 'pending',
    },
    {
      companyId: company._id,
      candidateUserId: user2._id,
      name: 'Anita Desai',
      role: 'Product Manager',
      department: 'Product',
      employeeScore: profile2.scoreCached,
      joiningDate: '2026-05-01',
      salaryBand: '18-22 LPA',
      status: 'pending',
    },
    {
      companyId: company._id,
      name: 'Vikram Singh',
      role: 'DevOps Engineer',
      department: 'Infrastructure',
      employeeScore: 620,
      status: 'approved',
    },
    {
      companyId: company._id,
      name: 'Sneha Patel',
      role: 'UX Designer',
      department: 'Design',
      employeeScore: 580,
      status: 'rejected',
    },
  ]);

  // QR onboarding
  await QrOnboarding.create({
    companyId: company._id,
    label: 'Campus Hiring 2026',
    code: 'VWQR-CAMP2026',
    scans: 142,
    joined: 18,
  });

  console.log('Seed complete!');
  console.log('');
  console.log('Platform Admin: admin@veriwork.com / Admin@VeriWork123');
  console.log('Enterprise login: hr@technova.com / VeriWork@123');
  console.log('Employee 1 (verified): +919888877766 — OTP: 123456');
  console.log('Employee 2 (partial):  +919777766655 — OTP: 123456');

  await disconnectDatabase();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
