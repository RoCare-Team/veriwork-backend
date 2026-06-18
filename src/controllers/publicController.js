import * as invitationService from '../services/invitationService.js';

export async function getEmployeeInvitation(req, res) {
  const data = await invitationService.getPublicInvitationByToken(req.params.token);
  res.json({ success: true, data });
}
