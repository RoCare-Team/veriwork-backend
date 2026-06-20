import { CompanyEmployee } from '../models/CompanyEmployee.js';
import { EmployeeProfile } from '../models/EmployeeProfile.js';
import { CompanyAuditLog } from '../models/CompanyAuditLog.js';
import { ApiError } from '../utils/ApiError.js';
import { assertValidObjectId } from '../utils/objectId.js';

function requireCompanyId(user) {
  if (!user.companyId) throw ApiError.forbidden('No company associated with this account');
  return user.companyId;
}

export async function markEmployeeVerifiedForCompany(companyId, employeeId) {
  const link = await CompanyEmployee.findOne({
    companyId,
    employeeId,
    employmentStatus: 'active',
  });
  if (!link) return null;

  if (link.onboardingStage === 'active') return link;

  link.onboardingStage = 'verified';
  link.verifiedAt = link.verifiedAt || new Date();
  await link.save();
  return link;
}

export async function assignEmployeeOnboarding(user, employeeId, payload) {
  const companyId = requireCompanyId(user);
  const validEmployeeId = assertValidObjectId(employeeId, 'employee id');

  const link = await CompanyEmployee.findOne({
    companyId,
    employeeId: validEmployeeId,
    employmentStatus: 'active',
  });
  if (!link) throw ApiError.notFound('Employee not found in your workforce');

  if (payload.department?.trim()) link.department = payload.department.trim();
  if (payload.designation?.trim()) link.designation = payload.designation.trim();
  if (payload.reportingManagerId) {
    link.reportingManagerId = assertValidObjectId(payload.reportingManagerId, 'reporting manager id');
  }

  if (payload.department || payload.designation || payload.reportingManagerId) {
    link.onboardingStage = 'active';
  }

  await link.save();

  await CompanyAuditLog.create({
    companyId,
    actorUserId: user._id,
    employeeId: validEmployeeId,
    action: 'employee_onboarding_assigned',
    entityType: 'company_employee',
    entityId: link._id,
    metadata: {
      department: link.department,
      designation: link.designation,
      onboardingStage: link.onboardingStage,
    },
  });

  const profile = await EmployeeProfile.findOne({ userId: validEmployeeId }).select('name');

  return {
    employeeId: validEmployeeId.toString(),
    employeeName: profile?.name || link.employeeName || '',
    department: link.department,
    designation: link.designation,
    reportingManagerId: link.reportingManagerId,
    onboardingStage: link.onboardingStage,
    verifiedAt: link.verifiedAt,
  };
}

export async function listWorkforceQueues(companyId) {
  const links = await CompanyEmployee.find({
    companyId,
    employmentStatus: 'active',
  }).sort({ createdAt: -1 });

  const employeeIds = links.map((l) => l.employeeId);
  const profiles = await EmployeeProfile.find({ userId: { $in: employeeIds } }).select('name userId');
  const profileMap = new Map(profiles.map((p) => [p.userId.toString(), p]));

  const enrich = (link) => ({
    employeeId: link.employeeId.toString(),
    employeeName: profileMap.get(link.employeeId.toString())?.name || link.employeeName || '',
    department: link.department || 'Unassigned',
    designation: link.designation || '',
    onboardingStage: link.onboardingStage,
    joinedAt: link.joinedAt,
    verifiedAt: link.verifiedAt,
  });

  return {
    incoming: links.filter((l) => ['incoming', 'pending_verification'].includes(l.onboardingStage)).map(enrich),
    verified: links.filter((l) => l.onboardingStage === 'verified').map(enrich),
    active: links.filter((l) => l.onboardingStage === 'active').map(enrich),
  };
}
