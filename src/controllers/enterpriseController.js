import * as enterpriseService from '../services/enterpriseService.js';
import * as teamService from '../services/teamService.js';
import * as accessRequestService from '../services/accessRequestService.js';
import * as insightsService from '../services/insightsService.js';
import * as qrOnboardingService from '../services/qrOnboardingService.js';
import * as onboardingReviewService from '../services/onboardingReviewService.js';

export async function getApplicationStatus(req, res) {
  const data = await onboardingReviewService.getMyApplicationStatus(req.user);
  res.json({ success: true, data });
}

export async function resubmitApplication(req, res) {
  const data = await onboardingReviewService.resubmitApplication(req.user);
  res.json({ success: true, data });
}

export async function listApplicationMessages(req, res) {
  const data = await onboardingReviewService.listOnboardingMessages(req.user.companyId);
  res.json({ success: true, data });
}

export async function postApplicationMessage(req, res) {
  const data = await onboardingReviewService.postOnboardingMessage(req.user.companyId, {
    body: req.body.body,
    authorRole: 'company',
    user: req.user,
  });
  res.status(201).json({ success: true, data });
}

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
  const codes = await qrOnboardingService.listQrCodes(req.user);
  res.json({ success: true, data: codes });
}

export async function createQrCode(req, res) {
  const code = await qrOnboardingService.createQrCode(req.user, req.body);
  res.status(201).json({ success: true, data: code });
}

export async function setQrActive(req, res) {
  const data = await qrOnboardingService.setQrActive(req.user, req.params.id, req.body.isActive);
  res.json({ success: true, data });
}

export async function deleteQrCode(req, res) {
  const data = await qrOnboardingService.deleteQrCode(req.user, req.params.id);
  res.json({ success: true, data });
}

export async function getDepartments(req, res) {
  const data = await teamService.getDepartments(req.user);
  res.json({ success: true, data });
}

export async function listTeamEmployees(req, res) {
  const data = await teamService.listTeamEmployees(req.user, req.query);
  res.json({ success: true, data });
}

export async function getTeamEmployee(req, res) {
  const data = await teamService.getTeamEmployee(req.user, req.params.id);
  res.json({ success: true, data });
}

export async function createAccessRequest(req, res) {
  const data = await accessRequestService.createAccessRequest(req.user, req.body);
  res.status(201).json({ success: true, data });
}

export async function listAccessRequests(req, res) {
  const data = await accessRequestService.listAccessRequests(req.user, req.query);
  res.json({ success: true, data });
}

export async function getAccessRequest(req, res) {
  const data = await accessRequestService.getAccessRequest(req.user, req.params.id);
  res.json({ success: true, data });
}

export async function getInsights(req, res) {
  const data = await insightsService.getCompanyInsights(req.user);
  res.json({ success: true, data });
}
