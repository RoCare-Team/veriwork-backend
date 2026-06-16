import { Company } from '../models/Company.js';
import { EmployeeProfile } from '../models/EmployeeProfile.js';
import { JoinRequest } from '../models/JoinRequest.js';
import { ApiError } from '../utils/ApiError.js';
import { getJobsForUser } from './employeeProfileService.js';
import {
  calculateEmployeeScore,
  getVerificationPercent,
  isVerificationComplete,
} from './scoreService.js';

const UNASSIGNED_DEPARTMENT = 'Unassigned';

function getCompanyId(user) {
  if (!user.companyId) throw ApiError.badRequest('No company associated with this account');
  return user.companyId;
}

function normalizeDepartment(department) {
  const trimmed = (department || '').trim();
  return trimmed || UNASSIGNED_DEPARTMENT;
}

async function enrichWorkforceMember(req) {
  if (!req.candidateUserId) {
    return {
      id: req._id,
      userId: null,
      name: req.name,
      role: req.role,
      department: normalizeDepartment(req.department),
      trustScore: req.employeeScore,
      employmentStatus: req.employmentStatus,
      veriworkId: null,
      joiningDate: req.joiningDate,
      avatar: req.avatar || '',
      email: '',
      isVerified: false,
      verificationPercent: 0,
    };
  }

  const profile = await EmployeeProfile.findOne({ userId: req.candidateUserId });
  const jobs = profile ? await getJobsForUser(req.candidateUserId) : [];

  return {
    id: req._id,
    userId: req.candidateUserId,
    name: profile?.name || req.name,
    role: profile?.role || req.role,
    department: normalizeDepartment(req.department),
    trustScore: profile ? calculateEmployeeScore(profile, jobs) : req.employeeScore,
    employmentStatus: req.employmentStatus,
    veriworkId: profile?.veriworkId || null,
    joiningDate: req.joiningDate,
    avatar: profile?.photoUrl || req.avatar || '',
    email: profile?.email || '',
    isVerified: profile ? isVerificationComplete(profile) : false,
    verificationPercent: profile ? getVerificationPercent(profile) : 0,
  };
}

export async function getDepartments(user) {
  const companyId = getCompanyId(user);
  const approved = await JoinRequest.find({ companyId, status: 'approved' }).select('department');

  const counts = new Map();
  for (const req of approved) {
    const dept = normalizeDepartment(req.department);
    counts.set(dept, (counts.get(dept) || 0) + 1);
  }

  const departments = [...counts.entries()]
    .map(([name, employeeCount]) => ({ name, employeeCount }))
    .sort((a, b) => b.employeeCount - a.employeeCount || a.name.localeCompare(b.name));

  return { departments };
}

export async function listTeamEmployees(user, query = {}) {
  const companyId = getCompanyId(user);
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter = { companyId, status: 'approved' };

  if (query.department) {
    if (query.department === UNASSIGNED_DEPARTMENT) {
      filter.$or = [{ department: '' }, { department: { $exists: false } }];
    } else {
      filter.department = query.department;
    }
  }

  if (query.employmentStatus) {
    filter.employmentStatus = query.employmentStatus;
  }

  const approved = await JoinRequest.find(filter).sort({ createdAt: -1 });
  let employees = await Promise.all(approved.map(enrichWorkforceMember));

  if (query.search) {
    const term = query.search.trim().toLowerCase();
    if (term) {
      employees = employees.filter((employee) => (
        employee.name.toLowerCase().includes(term)
        || employee.role.toLowerCase().includes(term)
        || (employee.veriworkId || '').toLowerCase().includes(term)
        || employee.department.toLowerCase().includes(term)
      ));
    }
  }

  const total = employees.length;
  const paginated = employees.slice(skip, skip + limit);

  return {
    employees: paginated,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

export async function getTeamEmployee(user, employeeId) {
  const companyId = getCompanyId(user);
  const req = await JoinRequest.findOne({
    _id: employeeId,
    companyId,
    status: 'approved',
  });

  if (!req) throw ApiError.notFound('Employee not found in your workforce');

  const employee = await enrichWorkforceMember(req);

  let profileDetails = null;
  if (req.candidateUserId) {
    const profile = await EmployeeProfile.findOne({ userId: req.candidateUserId });
    const jobs = profile ? await getJobsForUser(req.candidateUserId) : [];

    if (profile) {
      profileDetails = {
        phone: profile.phone,
        currentCity: profile.currentCity,
        totalExperience: profile.totalExperience,
        skills: profile.skills,
        aadhaarVerified: profile.aadhaarVerified,
        biometricVerified: profile.biometricVerified,
        digilockerUsed: profile.digilockerUsed,
        profileSetupComplete: profile.profileSetupComplete,
        publicSlug: profile.publicSlug,
        verifiedJobsCount: jobs.filter((job) => job.status === 'verified').length,
        totalJobsCount: jobs.length,
      };
    }
  }

  const company = await Company.findById(companyId).select('name');

  return {
    employee,
    company: company?.name || '',
    profile: profileDetails,
  };
}

export async function getApprovedWorkforce(user) {
  const companyId = getCompanyId(user);
  const approved = await JoinRequest.find({ companyId, status: 'approved' }).sort({ createdAt: -1 });
  return Promise.all(approved.map(enrichWorkforceMember));
}

export { normalizeDepartment, UNASSIGNED_DEPARTMENT };
