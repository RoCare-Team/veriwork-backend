import { AccessRequest } from '../models/AccessRequest.js';
import { ActivityLog } from '../models/ActivityLog.js';
import { Company } from '../models/Company.js';
import { CompanyAuditLog } from '../models/CompanyAuditLog.js';
import { CompanyEmployee } from '../models/CompanyEmployee.js';
import { CompanyEmployeeInvitation } from '../models/CompanyEmployeeInvitation.js';
import { Document } from '../models/Document.js';
import { EmployeeProfile } from '../models/EmployeeProfile.js';
import { JobExperience } from '../models/JobExperience.js';
import { VaultItem } from '../models/VaultItem.js';
import { VerificationRequest } from '../models/VerificationRequest.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { assertValidObjectId } from '../utils/objectId.js';
import {
  calculateEmployeeScore,
  getScoreRating,
  getScoreFactors,
  getVerificationPercent,
  isVerificationComplete,
} from './scoreService.js';
import {
  getEmployeeAccessGrants,
  requireEmployeeAccess,
  getConsentScope,
  getAccessRequestTitle,
  getAccessRequestMessage,
  ACCESS_TYPES,
  ACCESS_LABELS,
} from './employeeAccessService.js';
import {
  generateRegistrationToken,
  sendInvitationNotifications,
  buildEmployeeJoinLink,
} from './invitationService.js';
import { env } from '../config/env.js';
import { sendAccessRequestEmail } from './emailService.js';
import { getJobVerificationTag, computeProfileVerificationTags } from './verificationTagsService.js';
import { COMPLETED_VERIFIED_STATUSES } from '../utils/verificationStatusUtils.js';
import { listWorkforceQueues } from './workforceOnboardingService.js';
import {
  findPreviousCompanyByName,
  buildPermanentVerificationRecord,
} from './employmentVerificationService.js';

function requireCompanyId(user) {
  if (!user.companyId) throw ApiError.forbidden('No company associated with this account');
  return user.companyId;
}

function normalizeStatus(status) {
  if (status === 'accepted') return 'approved';
  return status;
}

async function createCompanyAuditLog({
  companyId,
  actorUserId,
  employeeId = null,
  action,
  entityType,
  entityId,
  metadata = {},
}) {
  await CompanyAuditLog.create({
    companyId,
    actorUserId,
    employeeId,
    action,
    entityType,
    entityId: entityId ? String(entityId) : '',
    metadata,
  });
}

async function resolveEmployee({ employeeEmail, employeeMobile, employeePagerlookId }) {
  const profileFilter = [];
  if (employeeEmail) profileFilter.push({ email: employeeEmail.toLowerCase() });
  if (employeeMobile) profileFilter.push({ phone: employeeMobile });
  if (employeePagerlookId) profileFilter.push({ veriworkId: employeePagerlookId });

  if (!profileFilter.length) return null;

  const profile = await EmployeeProfile.findOne({ $or: profileFilter });
  if (!profile) return null;
  return profile.userId;
}

export async function inviteEmployee(user, payload) {
  const companyId = requireCompanyId(user);
  const employeeId = await resolveEmployee(payload);
  const isRegistered = Boolean(employeeId);
  const status = isRegistered ? 'pending' : 'pending_registration';

  if (!isRegistered && !payload.employeeEmail) {
    throw ApiError.badRequest('Employee email is required to invite an unregistered employee');
  }

  const existingPending = await CompanyEmployeeInvitation.findOne({
    companyId,
    status: { $in: ['pending', 'pending_registration'] },
    $or: [
      ...(payload.employeeEmail ? [{ employeeEmail: payload.employeeEmail.toLowerCase() }] : []),
      ...(payload.employeeMobile ? [{ employeeMobile: payload.employeeMobile }] : []),
      ...(payload.employeePagerlookId ? [{ employeeVeriworkId: payload.employeePagerlookId }] : []),
      ...(employeeId ? [{ employeeId }] : []),
    ],
  });

  if (existingPending) {
    throw ApiError.conflict('Pending invitation already exists for this employee');
  }

  const registrationToken = isRegistered ? null : generateRegistrationToken();
  const registrationTokenExpiresAt = registrationToken
    ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    : null;

  const invitation = await CompanyEmployeeInvitation.create({
    companyId,
    employeeId,
    employeeName: payload.employeeName?.trim() || '',
    employeeEmail: payload.employeeEmail?.toLowerCase() || '',
    employeeMobile: payload.employeeMobile || '',
    employeeVeriworkId: payload.employeePagerlookId || '',
    department: payload.department || '',
    designation: payload.designation || '',
    status,
    invitedBy: user._id,
    invitedAt: new Date(),
    registrationToken,
    registrationTokenExpiresAt,
    autoJoinOnSetup: !isRegistered,
  });

  const company = await Company.findById(companyId).select('name');
  const notification = await sendInvitationNotifications({
    invitation,
    companyName: company?.name || 'Company',
    employeeName: payload.employeeName,
    isRegistered,
  });

  if (notification.emailSent) {
    invitation.emailSentAt = new Date();
    await invitation.save();
  }

  await createCompanyAuditLog({
    companyId,
    actorUserId: user._id,
    employeeId,
    action: 'invitation_sent',
    entityType: 'company_employee_invitation',
    entityId: invitation._id,
    metadata: {
      status,
      employeeName: invitation.employeeName,
      department: invitation.department,
      designation: invitation.designation,
      emailSent: notification.emailSent,
      emailMock: notification.emailMock,
      caseType: isRegistered ? 'registered' : 'not_registered',
    },
  });

  return {
    ...invitation.toObject(),
    caseType: isRegistered ? 'registered' : 'not_registered',
    emailSent: notification.emailSent,
    emailMock: notification.emailMock,
    registrationLink: registrationToken ? buildEmployeeJoinLink(registrationToken) : null,
    joinLink: notification.joinLink,
    dashboardStatus: isRegistered ? 'Invitation Sent' : 'Pending Registration',
  };
}

export async function listPendingInvitations(user) {
  const companyId = requireCompanyId(user);
  const invitations = await CompanyEmployeeInvitation.find({
    companyId,
    status: { $in: ['pending', 'pending_registration'] },
  }).sort({ createdAt: -1 });

  return invitations.map((invitation) => ({
    id: invitation._id,
    invitationId: invitation._id,
    employeeId: invitation.employeeId,
    employeeName: invitation.employeeName,
    employeeEmail: invitation.employeeEmail,
    employeeMobile: invitation.employeeMobile,
    department: invitation.department,
    designation: invitation.designation,
    status: invitation.status,
    dashboardStatus: invitation.status === 'pending_registration'
      ? 'Pending Registration'
      : 'Invitation Sent',
    emailSent: Boolean(invitation.emailSentAt),
    invitedAt: invitation.invitedAt,
    registrationLink: invitation.registrationToken
      ? buildEmployeeJoinLink(invitation.registrationToken)
      : null,
  }));
}

async function buildTeamEmployeeCard(companyId, link) {
  const [profile, jobs, access] = await Promise.all([
    EmployeeProfile.findOne({ userId: link.employeeId }),
    JobExperience.find({ userId: link.employeeId }),
    getEmployeeAccessGrants(companyId, link.employeeId),
  ]);

  const trustScore = profile ? calculateEmployeeScore(profile, jobs) : 300;
  const employeeId = link.employeeId.toString();

  const hasPending = access.pendingRequests.length > 0;
  const hasGranted = access.hasAnyAccess;

  let accessButton = 'request_access';
  let accessButtonLabel = 'Request Access';
  if (hasPending) {
    accessButton = 'pending';
    accessButtonLabel = 'Access Pending';
  } else if (hasGranted) {
    accessButton = 'remove_access';
    accessButtonLabel = 'Remove Access';
  }

  return {
    employeeId,
    id: employeeId,
    employeeName: profile?.name || 'Unknown Employee',
    role: link.designation || profile?.role || '',
    designation: link.designation || profile?.role || '',
    trustScore,
    trustScoreMax: 1000,
    employmentStatus: link.employmentStatus,
    onboardingStage: link.onboardingStage || 'incoming',
    statusLabel: link.onboardingStage === 'active'
      ? 'ACTIVE'
      : link.onboardingStage === 'verified'
        ? 'VERIFIED'
        : link.onboardingStage === 'pending_verification'
          ? 'PENDING VERIFICATION'
          : 'INCOMING',
    department: link.department || 'Unassigned',
    photoUrl: profile?.photoUrl || '',
    veriworkId: profile?.veriworkId || null,
    joinedAt: link.joinedAt,
    isVerified: profile ? isVerificationComplete(profile) : false,
    access: {
      fullProfileAccess: access.fullProfileAccess,
      profileAccess: access.profileAccess,
      backgroundCheck: access.backgroundCheck,
      verificationData: access.verificationData,
      hasAnyAccess: access.hasAnyAccess,
      hasAllAccess: access.hasAllAccess,
      showFullProfileButton: access.showFullProfileButton,
      pendingRequests: access.pendingRequests,
      approvedRequests: access.approvedRequests,
    },
    accessButton,
    accessButtonLabel,
    profilePath: `/company/team/${employeeId}`,
    profileApiPath: `/api/company/employees/${employeeId}/profile`,
  };
}

async function buildTeamEmployees(companyId, department = null) {
  const filter = { companyId, employmentStatus: 'active' };
  if (department) filter.department = department;

  const links = await CompanyEmployee.find(filter).sort({ createdAt: -1 });

  return Promise.all(links.map((link) => buildTeamEmployeeCard(companyId, link)));
}

export async function getCompanyTeam(user) {
  const companyId = requireCompanyId(user);
  const employees = await buildTeamEmployees(companyId);

  const grouped = new Map();
  for (const employee of employees) {
    const key = employee.department || 'Unassigned';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(employee);
  }

  const departments = [...grouped.entries()].map(([name, list]) => ({
    name,
    employeeCount: list.length,
    averageTrustScore: list.length
      ? Math.round(list.reduce((acc, employee) => acc + employee.trustScore, 0) / list.length)
      : 0,
    employees: list,
  }));

  return {
    departments,
    employees,
    totalEmployees: employees.length,
    workforceQueues: await listWorkforceQueues(companyId),
  };
}

export async function getCompanyWorkspace(user) {
  const companyId = requireCompanyId(user);
  const company = await Company.findById(companyId);
  if (!company) throw ApiError.notFound('Company not found');

  const [teamCount, adminUser] = await Promise.all([
    CompanyEmployee.countDocuments({ companyId, employmentStatus: 'active' }),
    User.findById(user._id).select('email role'),
  ]);

  return {
    id: company._id,
    name: company.name,
    industry: company.industry || '',
    companySize: company.companySize || '',
    workEmail: company.workEmail,
    contactName: company.contactName || '',
    phone: company.phone || '',
    country: company.country || '',
    city: company.city || '',
    isVerified: company.isVerified,
    onboardingComplete: company.onboardingComplete,
    totalEmployees: teamCount,
    admin: adminUser
      ? {
          id: adminUser._id,
          email: adminUser.email,
          role: adminUser.role,
          name: company.contactName || adminUser.email?.split('@')[0] || 'Admin',
        }
      : null,
  };
}

export async function getDepartmentDetails(user, department) {
  const companyId = requireCompanyId(user);
  return buildTeamEmployees(companyId, department);
}

export async function createCompanyAccessRequest(user, payload) {
  const companyId = requireCompanyId(user);

  const linkedEmployee = await CompanyEmployee.findOne({
    companyId,
    employeeId: payload.employeeId,
    employmentStatus: 'active',
  });
  if (!linkedEmployee) {
    throw ApiError.badRequest('Employee is not linked to this company');
  }

  const pending = await AccessRequest.findOne({
    companyId,
    employeeId: payload.employeeId,
    status: 'pending',
    requestType: payload.requestType,
  });
  if (pending) throw ApiError.conflict('Pending access request already exists');

  const profile = await EmployeeProfile.findOne({ userId: payload.employeeId });
  const company = await Company.findById(companyId).select('name');
  const requestType = payload.requestType || ACCESS_TYPES.PROFILE;

  const previousJob = await JobExperience.findOne({ userId: payload.employeeId })
    .sort({ isPresent: -1, createdAt: -1 });
  const previousEmployerName = previousJob?.company || '';

  const defaultMessage = getAccessRequestMessage(
    company?.name || 'A company',
    requestType,
    previousEmployerName,
  );

  const accessRequest = await AccessRequest.create({
    companyId,
    requestedBy: user._id,
    employeeId: payload.employeeId,
    employeeUserId: payload.employeeId,
    employeeName: profile?.name || '',
    requestType,
    message: payload.message?.trim() || defaultMessage,
    status: 'pending',
    requestedAt: new Date(),
    metadata: {
      consentScope: getConsentScope(requestType),
      previousEmployerName,
    },
  });

  const activityMessage = payload.message?.trim() || defaultMessage;

  await ActivityLog.create({
    userId: payload.employeeId,
    type: 'access_request',
    title: getAccessRequestTitle(requestType),
    message: activityMessage,
    company: company?.name || '',
    status: 'pending',
    metadata: {
      accessRequestId: accessRequest._id.toString(),
      requestType,
      previousEmployerName,
    },
  });

  const employeeEmail = profile?.email;
  if (employeeEmail) {
    await sendAccessRequestEmail({
      to: employeeEmail,
      employeeName: profile?.name || 'Employee',
      companyName: company?.name || 'A company',
      requestType,
      previousEmployerName,
      message: activityMessage,
      reviewLink: `${env.frontendUrl}/employee/access-requests`,
    });
  }

  await createCompanyAuditLog({
    companyId,
    actorUserId: user._id,
    employeeId: payload.employeeId,
    action: 'access_request_created',
    entityType: 'access_request',
    entityId: accessRequest._id,
    metadata: { requestType: payload.requestType },
  });

  return accessRequest;
}

function mapCompanyAccessRequest(request) {
  return {
    id: request._id,
    employeeId: request.employeeId || request.employeeUserId,
    employeeName: request.employeeName,
    requestType: request.requestType,
    message: request.message || '',
    requestTypeLabel: ACCESS_LABELS[request.requestType] || request.requestType,
    status: normalizeStatus(request.status),
    requestedAt: request.requestedAt || request.createdAt,
    respondedAt: request.respondedAt,
  };
}

export async function listCompanyAccessRequests(user) {
  const companyId = requireCompanyId(user);
  const requests = await AccessRequest.find({ companyId }).sort({ createdAt: -1 });

  const normalized = requests.map((req) => normalizeStatus(req.status));
  return {
    summary: {
      total: requests.length,
      accepted: normalized.filter((s) => s === 'approved').length,
      pending: normalized.filter((s) => s === 'pending').length,
      rejected: normalized.filter((s) => s === 'rejected').length,
    },
    requests: requests.map(mapCompanyAccessRequest),
  };
}

export async function getCompanyInsights(user) {
  const companyId = requireCompanyId(user);
  const team = await CompanyEmployee.find({ companyId, employmentStatus: 'active' });

  if (!team.length) {
    return {
      metrics: {
        totalEmployees: 0,
        averageTrustScore: 0,
        verifiedEmployees: 0,
        activeDepartments: 0,
      },
      verificationAnalytics: {
        totalRequests: 0,
        approved: 0,
        pending: 0,
        rejected: 0,
      },
      workforceGrowth: [],
      departmentDistribution: [],
      trustScoreDistribution: [],
    };
  }

  const departmentSet = new Set(team.map((member) => member.department || 'Unassigned'));
  let trustTotal = 0;
  let verifiedEmployees = 0;
  const departmentCounts = new Map();
  const growthMap = new Map();
  const bucketCounts = { '300-449': 0, '450-599': 0, '600-749': 0, '750-900': 0 };

  for (const member of team) {
    const dept = member.department || 'Unassigned';
    departmentCounts.set(dept, (departmentCounts.get(dept) || 0) + 1);

    const monthKey = parseMonthKey(member.joinedAt);
    if (monthKey) growthMap.set(monthKey, (growthMap.get(monthKey) || 0) + 1);

    const [profile, jobs] = await Promise.all([
      EmployeeProfile.findOne({ userId: member.employeeId }),
      JobExperience.find({ userId: member.employeeId }),
    ]);
    if (!profile) continue;

    const score = calculateEmployeeScore(profile, jobs);
    trustTotal += score;
    if (isVerificationComplete(profile)) verifiedEmployees += 1;

    if (score >= 750) bucketCounts['750-900'] += 1;
    else if (score >= 600) bucketCounts['600-749'] += 1;
    else if (score >= 450) bucketCounts['450-599'] += 1;
    else bucketCounts['300-449'] += 1;
  }

  const verificationRequests = await VerificationRequest.find({
    $or: [{ requestingCompanyId: companyId }, { targetCompanyId: companyId }],
  });

  const departmentDistribution = [...departmentCounts.entries()]
    .map(([department, count]) => ({
      department,
      count,
      percentage: Math.round((count / team.length) * 1000) / 10,
    }))
    .sort((a, b) => b.count - a.count);

  const workforceGrowth = [...growthMap.entries()]
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const trustScoreDistribution = Object.entries(bucketCounts).map(([range, count]) => ({
    range,
    count,
  }));

  return {
    metrics: {
      totalEmployees: team.length,
      averageTrustScore: Math.round(trustTotal / team.length),
      verifiedEmployees,
      activeDepartments: departmentSet.size,
    },
    verificationAnalytics: {
      totalRequests: verificationRequests.length,
      approved: verificationRequests.filter((r) => COMPLETED_VERIFIED_STATUSES.includes(r.status)).length,
      pending: verificationRequests.filter((r) => ['pending', 'in_process', 'in_review', 'hr_responded'].includes(r.status)).length,
      rejected: verificationRequests.filter((r) => r.status === 'rejected').length,
    },
    workforceGrowth,
    departmentDistribution,
    trustScoreDistribution,
  };
}

function parseMonthKey(dateValue) {
  if (!dateValue) return null;
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

async function hasApprovedAccess(companyId, employeeId, requestType = null) {
  const filter = {
    companyId,
    $or: [{ employeeId }, { employeeUserId: employeeId }],
    status: { $in: ['approved', 'accepted'] },
  };
  if (requestType) filter.requestType = requestType;
  const approved = await AccessRequest.findOne(filter);
  return Boolean(approved);
}

function mapVerificationLevelMeta(level) {
  const map = {
    employer_verified: {
      label: 'Employer Verified',
      tier: 5,
      color: 'indigo',
      description: 'Previous company confirmed directly on PagerLook',
      verifiedBy: 'Employer platform',
    },
    hr_verified: {
      label: 'HR Verified',
      tier: 4,
      color: 'blue',
      description: 'HR email confirmation received and approved',
      verifiedBy: 'HR email',
    },
    document_verified: {
      label: 'Document Verified',
      tier: 3,
      color: 'emerald',
      description: 'Verified using uploaded employment documents',
      verifiedBy: 'Document review',
    },
    none: {
      label: 'Not Verified',
      tier: 0,
      color: 'slate',
      description: 'Employment not yet verified',
      verifiedBy: null,
    },
  };
  return map[level] || map.none;
}

async function buildEmploymentHistory(jobs, employeeId, { includeDocuments = false, requestingCompanyId = null } = {}) {
  const jobIds = jobs.map((j) => j._id);

  const [documents, verificationRequests, platformChecks] = await Promise.all([
    includeDocuments
      ? Document.find({ userId: employeeId, jobId: { $in: jobIds } }).sort({ createdAt: -1 })
      : Promise.resolve([]),
    VerificationRequest.find({ employeeId, jobExperienceId: { $in: jobIds } })
      .sort({ createdAt: -1 }),
    Promise.all(
      jobs.map(async (job) => {
        const prev = await findPreviousCompanyByName(job.company, requestingCompanyId);
        return [job._id.toString(), prev ? { id: prev._id.toString(), name: prev.name } : null];
      }),
    ),
  ]);

  const docsByJob = documents.reduce((acc, doc) => {
    const key = doc.jobId?.toString();
    if (!key) return acc;
    if (!acc[key]) acc[key] = [];
    acc[key].push({
      id: doc._id,
      documentType: doc.documentType || 'other',
      originalName: doc.originalName || doc.fileName,
      status: doc.status,
      url: doc.url,
      uploadedAt: doc.createdAt,
    });
    return acc;
  }, {});

  const requestsByJob = verificationRequests.reduce((acc, req) => {
    const key = req.jobExperienceId?.toString();
    if (!key) return acc;
    if (!acc[key]) acc[key] = [];
    acc[key].push(req);
    return acc;
  }, {});

  const platformMap = Object.fromEntries(
    platformChecks.map(([jobId, match]) => [jobId, match]),
  );

  return Promise.all(jobs.map(async (job) => {
    const jobId = job._id.toString();
    const platformMatch = platformMap[jobId] || null;
    const onPlatform = Boolean(platformMatch);
    const tag = getJobVerificationTag(job);
    const levelMeta = mapVerificationLevelMeta(job.verificationLevel || 'none');
    const jobRequests = requestsByJob[jobId] || [];
    const latestRequest = jobRequests[0] || null;
    const approvedRequest = jobRequests.find((r) => COMPLETED_VERIFIED_STATUSES.includes(r.status)
      && r.verificationResult === 'verified') || null;
    const permanentRecord = ['document_verified', 'hr_verified', 'employer_verified'].includes(job.verificationLevel)
      ? buildPermanentVerificationRecord(job, approvedRequest)
      : null;

    return {
      id: job._id,
      title: job.title,
      company: job.company,
      employmentType: job.employmentType || 'Full-time',
      joiningDate: job.joiningDate,
      exitDate: job.exitDate,
      startDate: job.joiningDate,
      endDate: job.exitDate,
      isPresent: job.isPresent,
      duration: job.duration,
      salaryBand: job.salaryBand,
      employeeCode: job.employeeCode,
      department: job.department,
      workLocation: job.workLocation,
      uanNumber: job.uanNumber,
      pfNumber: job.pfNumber,
      esiNumber: job.esiNumber,
      companyPan: job.companyPan,
      companyCin: job.companyCin,
      companyGst: job.companyGst,
      lastDrawnSalary: job.lastDrawnSalary,
      managerName: job.managerName,
      description: job.description || '',
      status: job.status,
      verificationLevel: job.verificationLevel || 'none',
      verificationTag: tag,
      verificationMeta: levelMeta,
      isReusable: permanentRecord?.isReusable || false,
      confidenceScore: job.confidenceScore,
      verifiedAt: job.verifiedAt,
      verificationFeedback: job.verificationFeedback || approvedRequest?.employmentDetails?.feedback || '',
      rehireEligible: job.rehireEligible ?? approvedRequest?.employmentDetails?.rehireEligible ?? null,
      verificationNotes: job.verificationNotes || approvedRequest?.employmentDetails?.verificationNotes || '',
      hrEmail: job.hrEmail,
      managerEmail: job.managerEmail,
      previousCompanyOnPlatform: onPlatform,
      matchedPlatformCompany: platformMatch,
      verificationChannel: latestRequest?.verificationChannel || (onPlatform ? 'platform' : 'email'),
      verificationPath: onPlatform ? 'platform' : 'email',
      resolvedVia: approvedRequest?.resolvedVia || latestRequest?.resolvedVia || null,
      permanentRecord,
      documents: docsByJob[jobId] || [],
      documentCount: (docsByJob[jobId] || []).length,
      latestVerificationRequest: latestRequest
        ? {
            id: latestRequest._id,
            status: latestRequest.status,
            verificationChannel: latestRequest.verificationChannel,
            verificationLevel: latestRequest.verificationLevel,
            requestedAt: latestRequest.requestedAt || latestRequest.createdAt,
            respondedAt: latestRequest.respondedAt,
            employmentDetails: latestRequest.employmentDetails || {},
          }
        : null,
    };
  }));
}

function buildVerificationSection(profile, jobs, trustScore) {
  const scoreFactors = profile ? getScoreFactors(profile, jobs) : [];
  const hierarchy = profile ? computeProfileVerificationTags(profile, jobs) : { tags: [], highestLevel: 'none' };

  return {
    trustScore,
    scoreRating: getScoreRating(trustScore),
    scoreFactors,
    verificationHierarchy: hierarchy,
    verificationTags: hierarchy.tags,
    highestVerificationLevel: hierarchy.highestLevel,
    verificationStatus: {
      profileSetupComplete: profile?.profileSetupComplete || false,
      aadhaarVerified: profile?.aadhaarVerified || false,
      panVerified: profile?.panVerified || false,
      biometricVerified: profile?.biometricVerified || false,
      digilockerUsed: profile?.digilockerUsed || false,
      verificationPercent: profile ? getVerificationPercent(profile) : 0,
      isComplete: profile ? isVerificationComplete(profile) : false,
    },
    verifiedJobsCount: jobs.filter((j) => j.status === 'verified' || j.verificationLevel !== 'none').length,
    totalJobsCount: jobs.length,
    jobs: jobs.map((job) => ({
      id: job._id,
      company: job.company,
      title: job.title,
      verificationTag: getJobVerificationTag(job),
      verificationLevel: job.verificationLevel,
      isReusable: ['document_verified', 'hr_verified', 'employer_verified'].includes(job.verificationLevel),
    })),
  };
}

function buildProfileDetails(profile, link) {
  return {
    name: profile?.name || 'Unknown Employee',
    email: profile?.email || '',
    phone: profile?.phone || '',
    dateOfBirth: profile?.dateOfBirth || '',
    gender: profile?.gender || '',
    role: link.designation || profile?.role || '',
    department: link.department || 'Unassigned',
    company: profile?.company || '',
    totalExperience: profile?.totalExperience || '',
    currentCity: profile?.currentCity || '',
    currentAddress: profile?.currentAddress || '',
    permanentAddress: profile?.permanentAddress || '',
    skills: profile?.skills || [],
    photoUrl: profile?.photoUrl || '',
    veriworkId: profile?.veriworkId || null,
    publicSlug: profile?.publicSlug || null,
  };
}

export async function getEmployeeProfilePreview(user, employeeId) {
  const companyId = requireCompanyId(user);
  const validEmployeeId = assertValidObjectId(employeeId, 'employee id');

  const link = await CompanyEmployee.findOne({
    companyId,
    employeeId: validEmployeeId,
    employmentStatus: 'active',
  });
  if (!link) throw ApiError.notFound('Employee not found in your workforce');

  const [profile, jobs, vaultItems, access] = await Promise.all([
    EmployeeProfile.findOne({ userId: validEmployeeId }),
    JobExperience.find({ userId: validEmployeeId }).sort({ createdAt: -1 }),
    VaultItem.find({ userId: validEmployeeId }),
    getEmployeeAccessGrants(companyId, validEmployeeId),
  ]);

  const trustScore = profile ? calculateEmployeeScore(profile, jobs) : 300;

  const preview = {
    employeeId: validEmployeeId,
    name: profile?.name || 'Unknown Employee',
    role: link.designation || profile?.role || '',
    department: link.department || 'Unassigned',
    trustScore,
    employmentStatus: link.employmentStatus,
    onboardingStage: link.onboardingStage || 'incoming',
    veriworkId: profile?.veriworkId || null,
    isVerified: profile ? isVerificationComplete(profile) : false,
    joinedAt: link.joinedAt,
    photoUrl: profile?.photoUrl || '',
  };

  const accessGrants = {
    fullProfileAccess: access.fullProfileAccess,
    profileAccess: access.profileAccess,
    backgroundCheck: access.backgroundCheck,
    verificationData: access.verificationData,
    hasAllAccess: access.hasAllAccess,
    showFullProfileButton: access.showFullProfileButton,
    pendingRequests: access.pendingRequests,
  };

  const lockedSections = [];
  if (!access.profileAccess) {
    lockedSections.push({
      key: 'profile',
      label: 'Profile Details',
      requestType: ACCESS_TYPES.PROFILE,
      pending: access.pendingProfileAccess,
    });
  }
  if (!access.backgroundCheck) {
    lockedSections.push({
      key: 'background',
      label: 'Documents & Background',
      requestType: ACCESS_TYPES.BACKGROUND,
      pending: access.pendingBackgroundCheck,
    });
  }
  if (!access.verificationData) {
    lockedSections.push({
      key: 'verification',
      label: 'Verification Data',
      requestType: ACCESS_TYPES.VERIFICATION,
      pending: access.pendingVerificationData,
    });
  }
  if (!access.fullProfileAccess && lockedSections.length === 3) {
    lockedSections.unshift({
      key: 'full_profile',
      label: 'Get Full Profile Access',
      requestType: ACCESS_TYPES.FULL_PROFILE,
      pending: access.pendingFullProfileAccess,
      description: 'Unlock profile, documents, and verification in one request',
    });
  }

  const response = {
    preview,
    access: accessGrants,
    lockedSections,
    showFullProfileButton: access.showFullProfileButton,
    profileSection: null,
    employmentHistory: null,
    documentsSection: null,
    verificationSection: null,
  };

  if (access.profileAccess) {
    response.profileSection = buildProfileDetails(profile, link);
    response.employmentHistory = await buildEmploymentHistory(jobs, validEmployeeId, {
      includeDocuments: access.backgroundCheck,
      requestingCompanyId: companyId,
    });
  }

  if (access.backgroundCheck) {
    const vaultByCategory = vaultItems.reduce((acc, item) => {
      acc[item.category] = (acc[item.category] || 0) + 1;
      return acc;
    }, {});

    response.documentsSection = {
      summary: {
        totalDocuments: vaultItems.length,
        verifiedDocuments: vaultItems.filter((item) => item.status === 'verified').length,
        byCategory: vaultByCategory,
      },
      vaultItems: vaultItems.map((item) => ({
        id: item._id,
        category: item.category,
        name: item.name,
        status: item.status,
        size: item.size,
        uploadedAt: item.createdAt,
      })),
      viewDocumentsEndpoint: `/api/company/employees/${validEmployeeId}/documents`,
    };
  }

  if (access.verificationData) {
    response.verificationSection = buildVerificationSection(profile, jobs, trustScore);
  }

  return response;
}

export async function getEmployeeDocuments(user, employeeId) {
  const companyId = requireCompanyId(user);
  const validEmployeeId = assertValidObjectId(employeeId, 'employee id');

  const link = await CompanyEmployee.findOne({
    companyId,
    employeeId: validEmployeeId,
    employmentStatus: 'active',
  });
  if (!link) throw ApiError.notFound('Employee not found in your workforce');

  await requireEmployeeAccess(companyId, validEmployeeId, ACCESS_TYPES.BACKGROUND);

  const [vaultItems, jobDocs, jobs] = await Promise.all([
    VaultItem.find({ userId: validEmployeeId }).sort({ createdAt: -1 }),
    Document.find({ userId: validEmployeeId }).sort({ createdAt: -1 }),
    JobExperience.find({ userId: validEmployeeId }).select('title company'),
  ]);

  const jobMap = new Map(jobs.map((j) => [j._id.toString(), j]));

  const vaultWithFiles = await Promise.all(
    vaultItems.map(async (item) => {
      let file = null;
      if (item.documentId) {
        file = await Document.findById(item.documentId).select('fileName originalName url mimeType size status');
      }
      return {
        id: item._id,
        category: item.category,
        name: item.name,
        status: item.status,
        size: item.size,
        uploadedAt: item.createdAt,
        file: file
          ? {
              id: file._id,
              fileName: file.originalName || file.fileName,
              url: file.url,
              mimeType: file.mimeType,
              status: file.status,
            }
          : null,
      };
    }),
  );

  const employmentDocuments = jobDocs.map((doc) => {
    const job = doc.jobId ? jobMap.get(doc.jobId.toString()) : null;
    return {
      id: doc._id,
      jobId: doc.jobId,
      documentType: doc.documentType || 'other',
      category: doc.category,
      fileName: doc.originalName || doc.fileName,
      url: doc.url,
      mimeType: doc.mimeType,
      status: doc.status,
      jobTitle: job?.title || null,
      company: job?.company || null,
      uploadedAt: doc.createdAt,
    };
  });

  return {
    employeeId: validEmployeeId,
    vaultDocuments: vaultWithFiles,
    employmentDocuments,
    totalCount: vaultWithFiles.length + employmentDocuments.length,
  };
}

export async function getEmployeeAccessStatus(user, employeeId) {
  const companyId = requireCompanyId(user);
  const validEmployeeId = assertValidObjectId(employeeId, 'employee id');

  const link = await CompanyEmployee.findOne({
    companyId,
    employeeId: validEmployeeId,
    employmentStatus: 'active',
  });
  if (!link) throw ApiError.notFound('Employee not found in your workforce');

  const access = await getEmployeeAccessGrants(companyId, validEmployeeId);
  const hasPending = access.pendingRequests.length > 0;
  const accessButton = hasPending
    ? 'pending'
    : access.hasAnyAccess
      ? 'remove_access'
      : 'request_access';

  return {
    employeeId: validEmployeeId.toString(),
    ...access,
    canViewProfileDetails: access.profileAccess,
    canViewDocuments: access.backgroundCheck,
    canViewVerification: access.verificationData,
    accessButton,
    accessButtonLabel: hasPending
      ? 'Access Pending'
      : access.hasAnyAccess
        ? 'Remove Access'
        : 'Request Access',
    profilePath: `/company/team/${validEmployeeId}`,
    profileApiPath: `/api/company/employees/${validEmployeeId}/profile`,
  };
}

export async function revokeEmployeeAccess(user, employeeId, { requestType } = {}) {
  const companyId = requireCompanyId(user);
  const validEmployeeId = assertValidObjectId(employeeId, 'employee id');

  const link = await CompanyEmployee.findOne({
    companyId,
    employeeId: validEmployeeId,
    employmentStatus: 'active',
  });
  if (!link) throw ApiError.notFound('Employee not found in your workforce');

  const filter = {
    companyId,
    $or: [{ employeeId: validEmployeeId }, { employeeUserId: validEmployeeId }],
    status: { $in: ['approved', 'accepted'] },
  };
  if (requestType) filter.requestType = requestType;

  const approved = await AccessRequest.find(filter);
  if (!approved.length) {
    throw ApiError.badRequest('No active access grants found to revoke');
  }

  const revokedAt = new Date();
  await Promise.all(
    approved.map(async (request) => {
      request.status = 'revoked';
      request.respondedAt = revokedAt;
      request.metadata = {
        ...request.metadata,
        revokedBy: user._id.toString(),
        revokedAt: revokedAt.toISOString(),
      };
      await request.save();

      await createCompanyAuditLog({
        companyId,
        actorUserId: user._id,
        employeeId: validEmployeeId,
        action: 'access_request_revoked',
        entityType: 'access_request',
        entityId: request._id,
        metadata: { requestType: request.requestType },
      });
    }),
  );

  const company = await Company.findById(companyId).select('name');
  await ActivityLog.create({
    userId: validEmployeeId,
    type: 'system',
    title: 'Company access revoked',
    message: `${company?.name || 'A company'} removed access to your ${requestType || 'profile'} data`,
    company: company?.name || '',
    status: 'info',
    metadata: { requestType: requestType || 'all', revokedByCompanyId: companyId.toString() },
  });

  const access = await getEmployeeAccessGrants(companyId, validEmployeeId);
  return {
    employeeId: validEmployeeId.toString(),
    revokedCount: approved.length,
    revokedTypes: [...new Set(approved.map((r) => r.requestType))],
    access,
    accessButton: access.hasAnyAccess ? 'remove_access' : 'request_access',
    accessButtonLabel: access.hasAnyAccess ? 'Remove Access' : 'Request Access',
  };
}

export async function listCompanyAuditLogs(user, query = {}) {
  const companyId = requireCompanyId(user);
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter = { companyId };
  if (query.action) filter.action = query.action;

  const [logs, total] = await Promise.all([
    CompanyAuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    CompanyAuditLog.countDocuments(filter),
  ]);

  return {
    logs: logs.map((log) => ({
      id: log._id,
      action: log.action,
      actorUserId: log.actorUserId,
      employeeId: log.employeeId,
      entityType: log.entityType,
      entityId: log.entityId,
      metadata: log.metadata,
      createdAt: log.createdAt,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

export { createCompanyAuditLog };

export async function writeInvitationAuditFromEmployee(invitation, action) {
  await createCompanyAuditLog({
    companyId: invitation.companyId,
    actorUserId: invitation.employeeId,
    employeeId: invitation.employeeId,
    action,
    entityType: 'company_employee_invitation',
    entityId: invitation._id,
    metadata: {
      department: invitation.department,
      designation: invitation.designation,
    },
  });
}

export async function writeAccessAuditFromEmployee(accessRequest, action) {
  await createCompanyAuditLog({
    companyId: accessRequest.companyId,
    actorUserId: accessRequest.employeeId || accessRequest.employeeUserId,
    employeeId: accessRequest.employeeId || accessRequest.employeeUserId,
    action,
    entityType: 'access_request',
    entityId: accessRequest._id,
    metadata: { requestType: accessRequest.requestType },
  });
}
