import { AccessRequest } from '../models/AccessRequest.js';
import { ActivityLog } from '../models/ActivityLog.js';
import { Company } from '../models/Company.js';
import { CompanyAuditLog } from '../models/CompanyAuditLog.js';
import { CompanyEmployee } from '../models/CompanyEmployee.js';
import { CompanyEmployeeInvitation } from '../models/CompanyEmployeeInvitation.js';
import { EmployeeProfile } from '../models/EmployeeProfile.js';
import { JobExperience } from '../models/JobExperience.js';
import { VaultItem } from '../models/VaultItem.js';
import { VerificationRequest } from '../models/VerificationRequest.js';
import { ApiError } from '../utils/ApiError.js';
import { assertValidObjectId } from '../utils/objectId.js';
import {
  calculateEmployeeScore,
  getScoreRating,
  getVerificationPercent,
  isVerificationComplete,
} from './scoreService.js';

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
  const status = employeeId ? 'pending' : 'pending_registration';

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

  const invitation = await CompanyEmployeeInvitation.create({
    companyId,
    employeeId,
    employeeEmail: payload.employeeEmail?.toLowerCase() || '',
    employeeMobile: payload.employeeMobile || '',
    employeeVeriworkId: payload.employeePagerlookId || '',
    department: payload.department || '',
    designation: payload.designation || '',
    status,
    invitedBy: user._id,
    invitedAt: new Date(),
  });

  if (employeeId) {
    const company = await Company.findById(companyId).select('name');
    await ActivityLog.create({
      userId: employeeId,
      type: 'system',
      title: 'Company invitation received',
      message: `${company?.name || 'A company'} invited you to join ${payload.department || 'their team'}`,
      company: company?.name || '',
      status: 'pending',
      metadata: {
        invitationId: invitation._id.toString(),
      },
    });
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
      department: invitation.department,
      designation: invitation.designation,
    },
  });

  return invitation;
}

async function buildTeamEmployees(companyId, department = null) {
  const filter = { companyId };
  if (department) filter.department = department;

  const links = await CompanyEmployee.find(filter).sort({ createdAt: -1 });

  const employees = await Promise.all(
    links.map(async (link) => {
      const [profile, jobs] = await Promise.all([
        EmployeeProfile.findOne({ userId: link.employeeId }),
        JobExperience.find({ userId: link.employeeId }),
      ]);

      const trustScore = profile ? calculateEmployeeScore(profile, jobs) : 300;
      return {
        employeeId: link.employeeId,
        employeeName: profile?.name || 'Unknown Employee',
        role: link.designation || profile?.role || '',
        trustScore,
        employmentStatus: link.employmentStatus,
        department: link.department || 'Unassigned',
      };
    }),
  );

  return employees;
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

  return { departments };
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

  const accessRequest = await AccessRequest.create({
    companyId,
    requestedBy: user._id,
    employeeId: payload.employeeId,
    employeeUserId: payload.employeeId,
    employeeName: profile?.name || '',
    requestType: payload.requestType,
    status: 'pending',
    requestedAt: new Date(),
    metadata: {
      consentScope: ['trust_score', 'employment_history', 'verification_status', 'document_metadata'],
    },
  });

  await ActivityLog.create({
    userId: payload.employeeId,
    type: 'access_request',
    title: 'Company access request',
    message: `${company?.name || 'A company'} requested access to your profile data`,
    company: company?.name || '',
    status: 'pending',
    metadata: { accessRequestId: accessRequest._id.toString() },
  });

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
      approved: verificationRequests.filter((r) => r.status === 'approved').length,
      pending: verificationRequests.filter((r) => ['pending', 'in_process'].includes(r.status)).length,
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

async function hasApprovedAccess(companyId, employeeId) {
  const approved = await AccessRequest.findOne({
    companyId,
    $or: [{ employeeId }, { employeeUserId: employeeId }],
    status: { $in: ['approved', 'accepted'] },
  });
  return Boolean(approved);
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

  const [profile, jobs, vaultItems, accessApproved] = await Promise.all([
    EmployeeProfile.findOne({ userId: validEmployeeId }),
    JobExperience.find({ userId: validEmployeeId }).sort({ createdAt: -1 }),
    VaultItem.find({ userId: validEmployeeId }),
    hasApprovedAccess(companyId, validEmployeeId),
  ]);

  const trustScore = profile ? calculateEmployeeScore(profile, jobs) : 300;

  const preview = {
    employeeId: validEmployeeId,
    name: profile?.name || 'Unknown Employee',
    role: link.designation || profile?.role || '',
    department: link.department || 'Unassigned',
    trustScore,
    employmentStatus: link.employmentStatus,
    veriworkId: profile?.veriworkId || null,
    isVerified: profile ? isVerificationComplete(profile) : false,
    hasAccessApproval: accessApproved,
    joinedAt: link.joinedAt,
  };

  if (!accessApproved) {
    return {
      preview,
      detailedProfile: null,
      message: 'Submit an access request and wait for employee consent to view detailed profile',
    };
  }

  const vaultByCategory = vaultItems.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + 1;
    return acc;
  }, {});

  return {
    preview,
    detailedProfile: {
      trustScore,
      scoreRating: getScoreRating(trustScore),
      verificationStatus: {
        profileSetupComplete: profile?.profileSetupComplete || false,
        aadhaarVerified: profile?.aadhaarVerified || false,
        biometricVerified: profile?.biometricVerified || false,
        verificationPercent: profile ? getVerificationPercent(profile) : 0,
        isComplete: profile ? isVerificationComplete(profile) : false,
      },
      employmentHistory: jobs.map((job) => ({
        id: job._id,
        title: job.title,
        company: job.company,
        employmentType: job.employmentType,
        joiningDate: job.joiningDate,
        exitDate: job.exitDate,
        isPresent: job.isPresent,
        status: job.status,
        duration: job.duration,
      })),
      documentMetadata: {
        totalDocuments: vaultItems.length,
        verifiedDocuments: vaultItems.filter((item) => item.status === 'verified').length,
        byCategory: vaultByCategory,
      },
    },
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
