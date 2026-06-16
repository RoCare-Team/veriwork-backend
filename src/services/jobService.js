import { JobExperience } from '../models/JobExperience.js';
import { Document } from '../models/Document.js';
import { ApiError } from '../utils/ApiError.js';
import { storeUploadedFile } from '../utils/fileUpload.js';
import { refreshCachedScore } from './employeeProfileService.js';

function formatJob(job) {
  return {
    id: job._id,
    title: job.title,
    company: job.company,
    employmentType: job.employmentType || 'Full-time',
    salaryBand: job.salaryBand,
    joiningDate: job.joiningDate,
    exitDate: job.exitDate,
    isPresent: job.isPresent,
    duration: job.duration,
    companyEmail: job.companyEmail,
    hrEmail: job.hrEmail,
    description: job.description,
    status: job.status,
    statusLabel: job.status === 'verified'
      ? 'Verified'
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
  const job = await JobExperience.create({ userId, ...data });
  await refreshCachedScore(userId);
  return formatJob(job);
}

export async function getJobById(userId, jobId) {
  const job = await JobExperience.findOne({ _id: jobId, userId });
  if (!job) throw ApiError.notFound('Job not found');
  return job;
}

export async function addJobDocument(userId, jobId, file) {
  const job = await getJobById(userId, jobId);
  const stored = await storeUploadedFile(file, 'jobs');

  const doc = await Document.create({
    userId,
    jobId: job._id,
    category: 'job',
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
