import { JobExperience } from '../models/JobExperience.js';
import { Document } from '../models/Document.js';
import { ApiError } from '../utils/ApiError.js';
import { storeUploadedFile } from '../utils/fileUpload.js';
import { refreshCachedScore } from './employeeProfileService.js';
export async function listJobs(userId) {
  return JobExperience.find({ userId }).sort({ createdAt: -1 });
}

export async function createJob(userId, data) {
  const job = await JobExperience.create({ userId, ...data });
  await refreshCachedScore(userId);
  return job;
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
