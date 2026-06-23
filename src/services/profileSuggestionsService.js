import { Company } from '../models/Company.js';
import { JobExperience } from '../models/JobExperience.js';
import { EmployeeProfile } from '../models/EmployeeProfile.js';
import { normalizeCompanyName } from './employmentVerificationService.js';

const MIN_COMPANY_QUERY = 3;
const MIN_ROLE_QUERY = 1;
const DEFAULT_LIMIT = 8;

const COMMON_ROLES = [
  'Software Engineer',
  'Senior Software Engineer',
  'Staff Software Engineer',
  'Principal Engineer',
  'Frontend Developer',
  'Backend Developer',
  'Full Stack Developer',
  'Mobile Developer',
  'DevOps Engineer',
  'Cloud Engineer',
  'Data Engineer',
  'Data Scientist',
  'Machine Learning Engineer',
  'QA Engineer',
  'SDET',
  'Product Manager',
  'Senior Product Manager',
  'Product Designer',
  'UI/UX Designer',
  'Business Analyst',
  'Project Manager',
  'Scrum Master',
  'Technical Lead',
  'Engineering Manager',
  'HR Manager',
  'HR Executive',
  'Recruiter',
  'Sales Executive',
  'Account Manager',
  'Marketing Manager',
  'Digital Marketing Specialist',
  'Content Writer',
  'Financial Analyst',
  'Chartered Accountant',
  'Operations Manager',
  'Customer Success Manager',
  'Support Engineer',
  'System Administrator',
  'Network Engineer',
  'Security Analyst',
  'Intern',
  'Trainee',
];

function rankMatches(items, query, getLabel) {
  const q = query.trim().toLowerCase();
  return items
    .map((item) => {
      const label = getLabel(item);
      const lower = label.toLowerCase();
      let score = 0;
      if (lower === q) score = 100;
      else if (lower.startsWith(q)) score = 80;
      else if (lower.includes(q)) score = 60;
      else score = 40;
      return { item, score, label };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .map((entry) => entry.item);
}

export async function suggestCompanies(query, limit = DEFAULT_LIMIT) {
  const q = query?.trim();
  if (!q || q.length < MIN_COMPANY_QUERY) return [];

  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const normalizedQ = normalizeCompanyName(q);

  const [registered, jobCompanies, profileCompanies] = await Promise.all([
    Company.find({ name: { $regex: new RegExp(escaped, 'i') } })
      .select('name industry city')
      .limit(limit),
    JobExperience.distinct('company', { company: { $regex: new RegExp(escaped, 'i') } }),
    EmployeeProfile.distinct('company', { company: { $regex: new RegExp(escaped, 'i') } }),
  ]);

  const map = new Map();

  for (const company of registered) {
    map.set(company.name.toLowerCase(), {
      name: company.name,
      source: 'registered',
      industry: company.industry || '',
      city: company.city || '',
    });
  }

  for (const name of [...jobCompanies, ...profileCompanies]) {
    const trimmed = String(name || '').trim();
    if (!trimmed || trimmed.length < MIN_COMPANY_QUERY) continue;
    const key = trimmed.toLowerCase();
    if (!map.has(key)) {
      const n = normalizeCompanyName(trimmed);
      if (n.includes(normalizedQ) || normalizedQ.includes(n) || trimmed.toLowerCase().includes(q.toLowerCase())) {
        map.set(key, { name: trimmed, source: 'community', industry: '', city: '' });
      }
    }
  }

  return rankMatches([...map.values()], q, (c) => c.name).slice(0, limit);
}

export async function suggestRoles(query, limit = DEFAULT_LIMIT) {
  const q = query?.trim();
  if (!q || q.length < MIN_ROLE_QUERY) {
    return COMMON_ROLES.slice(0, limit).map((name) => ({ name, source: 'popular' }));
  }

  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const [jobTitles, profileRoles] = await Promise.all([
    JobExperience.distinct('title', { title: { $regex: new RegExp(escaped, 'i') } }),
    EmployeeProfile.distinct('role', { role: { $regex: new RegExp(escaped, 'i') } }),
  ]);

  const map = new Map();

  for (const name of COMMON_ROLES) {
    map.set(name.toLowerCase(), { name, source: 'popular' });
  }

  for (const title of [...jobTitles, ...profileRoles]) {
    const trimmed = String(title || '').trim();
    if (!trimmed || trimmed === 'Professional') continue;
    const key = trimmed.toLowerCase();
    if (!map.has(key)) {
      map.set(key, { name: trimmed, source: 'community' });
    }
  }

  return rankMatches([...map.values()], q, (r) => r.name).slice(0, limit);
}
