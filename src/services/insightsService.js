import { JoinRequest } from '../models/JoinRequest.js';
import { ApiError } from '../utils/ApiError.js';
import { getApprovedWorkforce, normalizeDepartment } from './teamService.js';

function getCompanyId(user) {
  if (!user.companyId) throw ApiError.badRequest('No company associated with this account');
  return user.companyId;
}

function parseMonthKey(dateValue) {
  if (!dateValue) return null;

  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return null;

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function getTrustScoreBucket(score) {
  if (score >= 750) return '750-900';
  if (score >= 600) return '600-749';
  if (score >= 450) return '450-599';
  return '300-449';
}

const TRUST_SCORE_BUCKETS = ['300-449', '450-599', '600-749', '750-900'];

export async function getCompanyInsights(user) {
  const companyId = getCompanyId(user);
  const [workforce, approvedRequests] = await Promise.all([
    getApprovedWorkforce(user),
    JoinRequest.find({ companyId, status: 'approved' }).select('joiningDate createdAt'),
  ]);

  const totalEmployees = workforce.length;
  const averageTrustScore = totalEmployees
    ? Math.round(workforce.reduce((sum, employee) => sum + employee.trustScore, 0) / totalEmployees)
    : 0;
  const verifiedEmployees = workforce.filter((employee) => employee.isVerified).length;

  const departmentSet = new Set(
    workforce.map((employee) => normalizeDepartment(employee.department)),
  );
  const activeDepartments = departmentSet.size;

  const growthMap = new Map();
  for (const req of approvedRequests) {
    const monthKey = parseMonthKey(req.joiningDate) || parseMonthKey(req.createdAt);
    if (!monthKey) continue;
    growthMap.set(monthKey, (growthMap.get(monthKey) || 0) + 1);
  }

  const workforceGrowth = [...growthMap.entries()]
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const departmentCounts = new Map();
  for (const employee of workforce) {
    const dept = normalizeDepartment(employee.department);
    departmentCounts.set(dept, (departmentCounts.get(dept) || 0) + 1);
  }

  const departmentDistribution = [...departmentCounts.entries()]
    .map(([department, count]) => ({
      department,
      count,
      percentage: totalEmployees ? Math.round((count / totalEmployees) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const bucketCounts = Object.fromEntries(TRUST_SCORE_BUCKETS.map((range) => [range, 0]));
  for (const employee of workforce) {
    const bucket = getTrustScoreBucket(employee.trustScore);
    bucketCounts[bucket] += 1;
  }

  const trustScoreDistribution = TRUST_SCORE_BUCKETS.map((range) => ({
    range,
    count: bucketCounts[range],
  }));

  const linkedEmployees = workforce.filter((employee) => employee.userId);
  const verificationAnalytics = {
    totalRequests: linkedEmployees.length,
    approved: linkedEmployees.filter((employee) => employee.isVerified).length,
    pending: linkedEmployees.filter((employee) => !employee.isVerified && employee.verificationPercent > 0).length,
    rejected: linkedEmployees.filter((employee) => !employee.isVerified && employee.verificationPercent === 0).length,
  };

  return {
    metrics: {
      totalEmployees,
      averageTrustScore,
      verifiedEmployees,
      activeDepartments,
    },
    workforceGrowth,
    departmentDistribution,
    trustScoreDistribution,
    verificationAnalytics,
  };
}
