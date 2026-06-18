import * as profileService from '../services/employeeProfileService.js';
import * as verificationService from '../services/verificationService.js';
import * as jobService from '../services/jobService.js';
import * as activityService from '../services/activityService.js';
import * as vaultService from '../services/vaultService.js';
import * as employeeLinkingService from '../services/employeeLinkingService.js';
import * as endorsementService from '../services/endorsementService.js';
import { storeUploadedFile } from '../utils/fileUpload.js';
export async function getProfile(req, res) {
  const profile = await profileService.getEmployeeProfile(req.user._id);
  res.json({ success: true, data: profile });
}

export async function updateProfile(req, res) {
  const profile = await profileService.updateEmployeeProfile(
    req.user._id,
    req.body,
    req.file ?? null,
  );
  res.json({ success: true, data: profile });
}

export async function setupProfile(req, res) {
  const profile = await profileService.setupEmployeeProfile(
    req.user._id,
    req.body,
    req.file ?? null,
  );
  res.json({ success: true, data: profile });
}

export async function getScore(req, res) {
  const score = await profileService.getEmployeeScore(req.user._id);
  res.json({ success: true, data: score });
}

export async function listEndorsements(req, res) {
  const data = await endorsementService.listEmployeeEndorsements(req.user._id);
  res.json({ success: true, data });
}

export async function endorseEmployee(req, res) {
  const data = await endorsementService.endorseEmployee(req.user._id, req.body);
  res.status(201).json({ success: true, data });
}

export async function getVerificationStatus(req, res) {
  const status = await verificationService.getVerificationStatus(req.user._id);
  res.json({ success: true, data: status });
}

export async function verifyAadhaar(req, res) {
  const result = await verificationService.verifyAadhaar(req.user._id, req.body);
  res.json({ success: true, data: result });
}

export async function verifyBiometric(req, res) {
  const stored = req.file ? await storeUploadedFile(req.file, 'biometric') : null;
  const result = await verificationService.verifyBiometric(req.user._id, stored?.url ?? null);
  res.json({ success: true, data: result });
}

export async function listJobs(req, res) {
  const jobs = await jobService.listJobs(req.user._id);
  res.json({ success: true, data: jobs });
}

export async function createJob(req, res) {
  const job = await jobService.createJob(req.user._id, req.body);
  res.status(201).json({ success: true, data: job });
}

export async function uploadJobDocument(req, res) {
  const doc = await jobService.addJobDocument(req.user._id, req.params.id, req.file);
  res.status(201).json({ success: true, data: doc });
}

export async function listActivity(req, res) {
  const activity = await activityService.listActivity(req.user._id, req.query);
  res.json({ success: true, data: activity });
}

export async function updateActivity(req, res) {
  const activity = await activityService.updateActivityStatus(
    req.user._id,
    req.params.id,
    req.body.status,
  );
  res.json({ success: true, data: activity });
}

export async function listVault(req, res) {
  const items = await vaultService.listVaultItems(req.user._id);
  res.json({ success: true, data: items });
}

export async function createVaultItem(req, res) {
  const item = await vaultService.createVaultItem(req.user._id, req.body, req.file);
  res.status(201).json({ success: true, data: item });
}

export async function getSettings(req, res) {
  const settings = await profileService.getEmployeeSettings(req.user._id);
  res.json({ success: true, data: settings });
}

export async function updateSettings(req, res) {
  const settings = await profileService.updateEmployeeSettings(req.user._id, req.body);
  res.json({ success: true, data: settings });
}

export async function getProfessionalId(req, res) {
  const data = await profileService.getProfessionalId(req.user._id);
  res.json({ success: true, data });
}

export async function listInvitations(req, res) {
  const data = await employeeLinkingService.listEmployeeInvitations(req.user._id);
  res.json({ success: true, data });
}

export async function acceptInvitation(req, res) {
  const invitationId = req.params.id || req.params.invitationId;
  const data = await employeeLinkingService.acceptInvitation(req.user._id, invitationId);
  res.json({ success: true, data });
}

export async function rejectInvitation(req, res) {
  const invitationId = req.params.id || req.params.invitationId;
  const data = await employeeLinkingService.rejectInvitation(req.user._id, invitationId);
  res.json({ success: true, data });
}

export async function listAccessRequests(req, res) {
  const data = await employeeLinkingService.listEmployeeAccessRequests(req.user._id);
  res.json({ success: true, data });
}

export async function approveAccessRequest(req, res) {
  const requestId = req.params.id || req.params.requestId;
  const data = await employeeLinkingService.approveEmployeeAccessRequest(req.user._id, requestId);
  res.json({ success: true, data });
}

export async function rejectAccessRequest(req, res) {
  const requestId = req.params.id || req.params.requestId;
  const data = await employeeLinkingService.rejectEmployeeAccessRequest(req.user._id, requestId);
  res.json({ success: true, data });
}
