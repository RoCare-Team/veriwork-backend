import { Company } from '../models/Company.js';
import { CompanyOnboarding } from '../models/CompanyOnboarding.js';
import { EmployeeProfile } from '../models/EmployeeProfile.js';
import { JoinRequest } from '../models/JoinRequest.js';
import { QrOnboarding } from '../models/QrOnboarding.js';
import { ApiError } from '../utils/ApiError.js';
import { storeUploadedFile } from '../utils/fileUpload.js';
import { getJobsForUser } from './employeeProfileService.js';
import { calculateEmployeeScore } from './scoreService.js';
import { v4 as uuidv4 } from 'uuid';

function getCompanyId(user) {
  if (!user.companyId) throw ApiError.badRequest('No company associated with this account');
  return user.companyId;
}

export async function getOnboarding(user) {
  const companyId = getCompanyId(user);
  const onboarding = await CompanyOnboarding.findOne({ companyId });
  const company = await Company.findById(companyId);
  if (!onboarding || !company) throw ApiError.notFound('Onboarding not found');

  return { company, onboarding };
}

export async function updateBasicInfo(user, data) {
  const companyId = getCompanyId(user);
  const [company, onboarding] = await Promise.all([
    Company.findById(companyId),
    CompanyOnboarding.findOne({ companyId }),
  ]);

  if (!company || !onboarding) throw ApiError.notFound('Company not found');

  Object.assign(onboarding.basicInfo, data);
  if (data.companyName) company.name = data.companyName;
  if (data.workEmail) company.workEmail = data.workEmail;
  if (data.industry) company.industry = data.industry;
  if (data.companySize) company.companySize = data.companySize;
  if (data.contactName) company.contactName = data.contactName;
  if (data.phone) company.phone = data.phone;
  if (data.country) company.country = data.country;
  if (data.city) company.city = data.city;

  await Promise.all([company.save(), onboarding.save()]);
  return { company, onboarding };
}

export async function updateRegistration(user, data) {
  const companyId = getCompanyId(user);
  const [company, onboarding] = await Promise.all([
    Company.findById(companyId),
    CompanyOnboarding.findOne({ companyId }),
  ]);

  if (!company || !onboarding) throw ApiError.notFound('Company not found');

  Object.assign(onboarding.registration, data);
  if (data.brn) company.brn = data.brn;
  if (data.taxId) company.taxId = data.taxId;

  await Promise.all([company.save(), onboarding.save()]);
  return { company, onboarding };
}

export async function uploadOnboardingDocument(user, docType, file) {
  const companyId = getCompanyId(user);
  const onboarding = await CompanyOnboarding.findOne({ companyId });
  if (!onboarding) throw ApiError.notFound('Onboarding not found');

  const stored = await storeUploadedFile(file, `enterprise/${docType}`);
  onboarding.documents.set(docType, stored.url);
  await onboarding.save();

  return {
    docType,
    url: stored.url,
    documents: Object.fromEntries(onboarding.documents),
  };
}

export async function submitOnboarding(user, { certified }) {
  if (!certified) throw ApiError.badRequest('You must certify the information is accurate');

  const companyId = getCompanyId(user);
  const [company, onboarding] = await Promise.all([
    Company.findById(companyId),
    CompanyOnboarding.findOne({ companyId }),
  ]);

  if (!onboarding) throw ApiError.notFound('Onboarding not found');

  if (onboarding.status === 'approved') {
    throw ApiError.badRequest('Company is already approved');
  }
  if (onboarding.status === 'submitted') {
    throw ApiError.badRequest('Application is already pending admin review');
  }

  onboarding.certified = true;
  onboarding.status = 'submitted';
  onboarding.rejectionReason = '';
  onboarding.reviewedAt = null;
  onboarding.reviewedBy = null;

  await onboarding.save();

  return {
    message: 'Application submitted successfully. Awaiting admin approval.',
    status: onboarding.status,
    onboardingComplete: company.onboardingComplete,
    homeRoute: '/enterprise/pending-approval',
  };
}

export async function getDashboard(user) {
  const companyId = getCompanyId(user);

  const [joinRequests, workforceCount, qrCodes] = await Promise.all([
    JoinRequest.find({ companyId }),
    JoinRequest.countDocuments({ companyId, status: 'approved' }),
    QrOnboarding.countDocuments({ companyId, isActive: true }),
  ]);

  const pending = joinRequests.filter((r) => r.status === 'pending').length;
  const avgScore = joinRequests.length
    ? Math.round(joinRequests.reduce((sum, r) => sum + r.employeeScore, 0) / joinRequests.length)
    : 0;

  return {
    stats: {
      totalCandidates: joinRequests.length,
      pendingRequests: pending,
      approvedEmployees: workforceCount,
      activeQrCodes: qrCodes,
      avgVeriScore: avgScore,
    },
  };
}

export async function getWorkforce(user) {
  const companyId = getCompanyId(user);
  const approved = await JoinRequest.find({ companyId, status: 'approved' }).sort({ createdAt: -1 });

  const employees = await Promise.all(
    approved.map(async (req) => {
      if (!req.candidateUserId) {
        return {
          id: req._id,
          name: req.name,
          role: req.role,
          department: req.department,
          employeeScore: req.employeeScore,
          employmentStatus: req.employmentStatus,
          joiningDate: req.joiningDate,
          status: req.status,
        };
      }

      const profile = await EmployeeProfile.findOne({ userId: req.candidateUserId });
      const jobs = profile ? await getJobsForUser(req.candidateUserId) : [];

      return {
        id: req._id,
        userId: req.candidateUserId,
        name: profile?.name || req.name,
        role: profile?.role || req.role,
        department: req.department,
        employeeScore: profile ? calculateEmployeeScore(profile, jobs) : req.employeeScore,
        trustScore: profile ? calculateEmployeeScore(profile, jobs) : req.employeeScore,
        employmentStatus: req.employmentStatus,
        veriworkId: profile?.veriworkId,
        joiningDate: req.joiningDate,
        status: req.status,
      };
    }),
  );

  return { employees };
}

export async function listJoinRequests(user) {
  const companyId = getCompanyId(user);
  return JoinRequest.find({ companyId }).sort({ createdAt: -1 });
}

export async function createJoinRequest(user, data) {
  const companyId = getCompanyId(user);

  let employeeScore = 300;
  if (data.candidateUserId) {
    const profile = await EmployeeProfile.findOne({ userId: data.candidateUserId });
    if (profile) {
      const jobs = await getJobsForUser(data.candidateUserId);
      employeeScore = calculateEmployeeScore(profile, jobs);
    }
  }

  return JoinRequest.create({
    companyId,
    candidateUserId: data.candidateUserId,
    name: data.name,
    role: data.role,
    department: data.department || '',
    employeeScore,
    joiningDate: data.joiningDate || '',
    salaryBand: data.salaryBand || '',
  });
}

export async function updateJoinRequest(user, requestId, status) {
  const companyId = getCompanyId(user);
  const request = await JoinRequest.findOne({ _id: requestId, companyId });
  if (!request) throw ApiError.notFound('Join request not found');

  request.status = status;
  await request.save();
  return request;
}

export async function listQrCodes(user) {
  const companyId = getCompanyId(user);
  return QrOnboarding.find({ companyId }).sort({ createdAt: -1 });
}

export async function createQrCode(user, label) {
  const companyId = getCompanyId(user);
  const code = `VWQR-${uuidv4().slice(0, 8).toUpperCase()}`;

  return QrOnboarding.create({
    companyId,
    label,
    code,
  });
}
