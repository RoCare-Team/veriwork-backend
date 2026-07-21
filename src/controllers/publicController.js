import * as invitationService from '../services/invitationService.js';
import * as verificationRequestService from '../services/verificationRequestService.js';
import * as publicProfileService from '../services/publicProfileService.js';
import * as companyUsersService from '../services/companyUsersService.js';
import * as qrOnboardingService from '../services/qrOnboardingService.js';

export async function getQrJoinInfo(req, res) {
  const data = await qrOnboardingService.getQrJoinInfo(req.params.code);
  res.json({ success: true, data });
}

export async function submitQrJoinRequest(req, res) {
  const data = await qrOnboardingService.submitQrJoinRequest(req.params.code, req.body);
  res.status(201).json({ success: true, data });
}

export async function getCompanyUserInvite(req, res) {
  const data = await companyUsersService.getCompanyUserInvite(req.params.token);
  res.json({ success: true, data });
}

export async function acceptCompanyUserInvite(req, res) {
  const data = await companyUsersService.acceptCompanyUserInvite(req.params.token, req.body.password);
  res.json({ success: true, data });
}

export async function getPublicProfile(req, res) {
  const data = await publicProfileService.getPublicProfileBySlug(req.params.slug);
  res.json({ success: true, data });
}

export async function requestPublicProfileAccess(req, res) {
  const data = await publicProfileService.requestPublicFullProfileAccess(req.params.slug, req.body);
  res.status(201).json({ success: true, data });
}

export async function getEmployeeInvitation(req, res) {
  const data = await invitationService.getPublicInvitationByToken(req.params.token);
  res.json({ success: true, data });
}

export async function getEmploymentVerification(req, res) {
  const data = await verificationRequestService.getPublicVerificationByToken(req.params.token);
  res.json({ success: true, data });
}

export async function respondEmploymentVerification(req, res) {
  const data = await verificationRequestService.respondToPublicVerification(
    req.params.token,
    req.body,
  );
  res.json({ success: true, data });
}

export async function uploadEmploymentVerificationDocument(req, res) {
  const data = await verificationRequestService.uploadPublicVerificationDocument(
    req.params.token,
    req.file,
  );
  res.status(201).json({ success: true, data });
}
