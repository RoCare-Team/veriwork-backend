import { JobExperience } from '../models/JobExperience.js';
import { Document } from '../models/Document.js';
import { ApiError } from '../utils/ApiError.js';
import { storeUploadedFile } from '../utils/fileUpload.js';
import { refreshCachedScore } from './employeeProfileService.js';
import { getJobVerificationTag } from './verificationTagsService.js';

const DOCUMENT_TYPES = [
  'offer_letter',
  'salary_slip',
  'experience_letter',
  'relieving_letter',
  'pf_statement',
  'form_16',
  'other',
];

function buildDuration(joiningDate, exitDate, isPresent) {
  if (!joiningDate) return '';
  if (isPresent) return `${joiningDate} – Present`;
  if (exitDate) return `${joiningDate} – ${exitDate}`;
  return joiningDate;
}

function formatJob(job) {
  const tag = getJobVerificationTag(job);
  return {
    id: job._id,
    title: job.title,
    company: job.company,
    employmentType: job.employmentType || 'Full-time',
    salaryBand: job.salaryBand,
    joiningDate: job.joiningDate,
    exitDate: job.exitDate,
    isPresent: job.isPresent,
    duration: job.duration || buildDuration(job.joiningDate, job.exitDate, job.isPresent),
    companyEmail: job.companyEmail,
    hrContacts: job.hrContacts?.length
      ? job.hrContacts
      : [job.hrEmail, job.managerEmail].filter(Boolean), // pre-hrContacts rows
    hrEmail: job.hrEmail,
    managerEmail: job.managerEmail,
    managerName: job.managerName,
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
    description: job.description,
    status: job.status,
    verificationLevel: job.verificationLevel || 'none',
    verificationTag: tag,
    verifiedAt: job.verifiedAt,
    confidenceScore: job.confidenceScore,
    statusLabel: job.status === 'verified'
      ? tag.label
      : job.status === 'in_process'
        ? 'In Process'
        : 'Not Verified',
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export async function listJobs(userId) {
  const jobs = await JobExperience.find({ userId }).sort({ createdAt: -1 });
  const verifiedCount = jobs.filter((job) => job.status === 'verified').length;

  return {
    summary: {
      totalRoles: jobs.length,
      verifiedCount,
      verifiedLabel: `${verifiedCount}/${jobs.length}`,
    },
    jobs: jobs.map(formatJob),
  };
}

export async function createJob(userId, data) {
  const payload = {
    ...data,
    duration: data.duration || buildDuration(data.joiningDate, data.exitDate, data.isPresent),
  };
  const job = await JobExperience.create({ userId, ...payload });
  await refreshCachedScore(userId);
  return formatJob(job);
}

export async function getJobById(userId, jobId) {
  const job = await JobExperience.findOne({ _id: jobId, userId });
  if (!job) throw ApiError.notFound('Job not found');
  return job;
}

export async function addJobDocument(userId, jobId, file, meta = {}) {
  const job = await getJobById(userId, jobId);
  const stored = await storeUploadedFile(file, 'jobs');

  const documentType = DOCUMENT_TYPES.includes(meta.documentType)
    ? meta.documentType
    : 'other';

  const doc = await Document.create({
    userId,
    jobId: job._id,
    category: 'job',
    documentType,
    fileName: stored.fileName,
    originalName: stored.originalName,
    mimeType: stored.mimeType,
    size: stored.size,
    url: stored.url,
  });

  return doc;
}

export async function getJobDocuments(userId, jobId) {
  await getJobById(userId, jobId);
  return Document.find({ userId, jobId }).sort({ createdAt: -1 });
}
