import * as enterpriseService from '../services/enterpriseService.js';

export async function getOnboarding(req, res) {
  const data = await enterpriseService.getOnboarding(req.user);
  res.json({ success: true, data });
}

export async function updateBasicInfo(req, res) {
  const data = await enterpriseService.updateBasicInfo(req.user, req.body);
  res.json({ success: true, data });
}

export async function updateRegistration(req, res) {
  const data = await enterpriseService.updateRegistration(req.user, req.body);
  res.json({ success: true, data });
}

export async function uploadDocument(req, res) {
  const docType = req.params.docType;
  const data = await enterpriseService.uploadOnboardingDocument(req.user, docType, req.file);
  res.json({ success: true, data });
}

export async function submitOnboarding(req, res) {
  const data = await enterpriseService.submitOnboarding(req.user, req.body);
  res.json({ success: true, data });
}

export async function getDashboard(req, res) {
  const data = await enterpriseService.getDashboard(req.user);
  res.json({ success: true, data });
}

export async function getWorkforce(req, res) {
  const data = await enterpriseService.getWorkforce(req.user);
  res.json({ success: true, data });
}

export async function listJoinRequests(req, res) {
  const requests = await enterpriseService.listJoinRequests(req.user);
  res.json({ success: true, data: requests });
}

export async function createJoinRequest(req, res) {
  const request = await enterpriseService.createJoinRequest(req.user, req.body);
  res.status(201).json({ success: true, data: request });
}

export async function updateJoinRequest(req, res) {
  const request = await enterpriseService.updateJoinRequest(
    req.user,
    req.params.id,
    req.body.status,
  );
  res.json({ success: true, data: request });
}

export async function listQrCodes(req, res) {
  const codes = await enterpriseService.listQrCodes(req.user);
  res.json({ success: true, data: codes });
}

export async function createQrCode(req, res) {
  const code = await enterpriseService.createQrCode(req.user, req.body.label);
  res.status(201).json({ success: true, data: code });
}
