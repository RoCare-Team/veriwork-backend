import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { connectDatabase, disconnectDatabase } from './src/config/database.js'
import { User } from './src/models/User.js'
import { Company } from './src/models/Company.js'
import { CompanyOnboarding } from './src/models/CompanyOnboarding.js'
import { sendPasswordResetEmail } from './src/services/emailService.js'

const EMAIL = 'skc26601@gmail.com'
const PASSWORD = 'Enterprise@123'
const PROD_ORIGIN = 'https://pagerlook.com'

await connectDatabase()

let company = await Company.findOne({ workEmail: EMAIL })
if (!company) {
  company = await Company.create({
    name: 'Pagerlook Test Company', industry: 'Technology', companySize: '11-50',
    workEmail: EMAIL, contactName: 'Test Admin', phone: '+919000000000',
    country: 'India', city: 'Gurgaon', isVerified: true, onboardingComplete: true,
  })
  await CompanyOnboarding.create({
    companyId: company._id,
    basicInfo: { companyName: company.name, industry: company.industry, companySize: company.companySize,
      workEmail: company.workEmail, contactName: company.contactName, phone: company.phone,
      country: company.country, city: company.city },
    certified: true, status: 'approved', reviewedAt: new Date(),
  })
  console.log(`Company created (id=${company._id})`)
} else {
  console.log(`Company already exists (id=${company._id})`)
}

const passwordHash = await bcrypt.hash(PASSWORD, 10)
let user = await User.findOne({ email: EMAIL })
if (!user) {
  user = await User.create({ email: EMAIL, passwordHash, role: 'enterprise_admin',
    companyRole: 'owner', companyId: company._id, isActive: true })
  console.log(`Enterprise user created (id=${user._id})`)
} else {
  user.passwordHash = passwordHash; user.role = 'enterprise_admin'
  user.companyRole = user.companyRole || 'owner'; user.companyId = user.companyId || company._id
  await user.save()
  console.log(`Enterprise user updated (id=${user._id})`)
}

// Generate a real reset token + send the email to prove the pipeline end-to-end.
const rawToken = crypto.randomBytes(32).toString('hex')
user.resetPasswordTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000)
await user.save()

const resetLink = `${PROD_ORIGIN}/reset-password?token=${rawToken}`
const result = await sendPasswordResetEmail({ to: EMAIL, resetLink, expiresMinutes: 60 })
console.log('Reset email result:', JSON.stringify(result))
console.log(`\nEnterprise login -> ${EMAIL} / ${PASSWORD}`)
await disconnectDatabase()
