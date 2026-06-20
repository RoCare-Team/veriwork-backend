import * as invitationService from '../services/invitationService.js';
import * as verificationRequestService from '../services/verificationRequestService.js';
import * as publicProfileService from '../services/publicProfileService.js';

export async function getPublicProfile(req, res) {
  const data = await publicProfileService.getPublicProfileBySlug(req.params.slug);
  res.json({ success: true, data });
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
