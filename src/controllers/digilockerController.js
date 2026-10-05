import * as digilockerService from '../services/digilockerService.js';

export async function connect(req, res) {
  const data = await digilockerService.createAuthorizationUrl(req.user._id);
  res.json({ success: true, data });
}

// DigiLocker redirects the user's browser here after consent. There is no JWT on
// this request — the user is identified by the one-time `state` we issued in connect.
export async function callback(req, res) {
  const { code, state, error } = req.query;
  const result = await digilockerService.handleCallback({
    code: typeof code === 'string' ? code : undefined,
    state: typeof state === 'string' ? state : undefined,
    error: typeof error === 'string' ? error : undefined,
  });

  const target = new URL(result.redirect);
  if (result.message) target.searchParams.set('message', result.message);
  res.redirect(302, target.toString());
}

export async function getConnection(req, res) {
  const data = await digilockerService.getConnection(req.user._id);
  res.json({ success: true, data });
}

export async function getDocuments(req, res) {
  const data = await digilockerService.getPermittedDocuments(req.user._id);
  res.json({ success: true, data });
}

export async function disconnect(req, res) {
  const data = await digilockerService.disconnect(req.user._id);
  res.json({ success: true, data });
}
