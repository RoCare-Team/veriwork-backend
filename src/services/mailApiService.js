import { env } from '../config/env.js';

/**
 * Limbu Mail Studio HTTP API client.
 *
 * This is the transport every system email now leaves through — password
 * resets, employment-verification requests, invitations, notifications. It
 * replaces the raw SMTP socket for platform mail: no connection pool to run
 * out of, no "421 too many concurrent connections" from a shared host, and no
 * mailbox password sitting on the server.
 *
 * The sending identity (verified domain and from-address) belongs to the Mail
 * Studio account behind MAIL_API_KEY, so switching the sender is an account
 * change over there, not a code change here.
 *
 * Nothing in this file throws for a delivery failure the caller can survive —
 * emailService decides whether to fall back to SMTP, so failures are surfaced
 * as thrown errors only at the request level and caught one layer up.
 */

const api = env.email.api;

export function isMailApiEnabled() {
  return Boolean(api.enabled && api.apiKey);
}

/** Errors that are worth retrying: network blips and 5xx, never a 4xx. */
class MailApiError extends Error {
  constructor(message, { status = 0, retryable = false } = {}) {
    super(message);
    this.name = 'MailApiError';
    this.status = status;
    this.retryable = retryable;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One authenticated JSON call against the Mail Studio API, with a hard timeout
 * and bounded retries on transient failures.
 */
async function request(method, path, body = null) {
  if (!isMailApiEnabled()) {
    throw new MailApiError('Mail API is not configured (set MAIL_API_KEY)');
  }

  const url = `${api.baseUrl}${path}`;
  const attempts = Math.max(1, api.retries + 1);
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    // AbortSignal.timeout keeps a hung provider from holding an API request open.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), api.timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${api.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const raw = await response.text();
      let payload = null;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        payload = { detail: raw?.slice(0, 300) };
      }

      if (!response.ok) {
        const detail = payload?.detail || payload?.message || `HTTP ${response.status}`;
        // 429 and 5xx are the provider's problem and may clear on a retry;
        // 400/401/403 mean our payload or key is wrong and never will.
        const retryable = response.status === 429 || response.status >= 500;
        throw new MailApiError(String(detail), { status: response.status, retryable });
      }

      return payload || {};
    } catch (err) {
      lastError =
        err instanceof MailApiError
          ? err
          : new MailApiError(
              err.name === 'AbortError' ? `timed out after ${api.timeoutMs}ms` : err.message,
              { retryable: true },
            );

      if (!lastError.retryable || attempt === attempts) break;
      // Short exponential backoff: 400ms, 800ms, …
      await sleep(400 * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

/**
 * Send one transactional email (the endpoint used for every system mail).
 *
 * @param {object} opts
 * @param {string} opts.to        Recipient address.
 * @param {string} [opts.cc]      Optional carbon copy.
 * @param {string} [opts.bcc]
 * @param {string} opts.subject
 * @param {string} opts.html      Rendered HTML body.
 * @param {string} [opts.text]    Plain-text alternative.
 * @param {string} [opts.replyTo]
 * @returns {Promise<{sent:boolean, messageId:string|null}>}
 */
export async function sendTransactionalEmail({
  to,
  cc = null,
  bcc = null,
  subject,
  html,
  text = '',
  replyTo = '',
}) {
  const payload = { to, subject, html };
  if (text) payload.text = text;
  if (cc) payload.cc = cc;
  if (bcc) payload.bcc = bcc;

  const from = api.from || '';
  if (from) payload.from = from;
  if (api.fromName) payload.from_name = api.fromName;

  const reply = replyTo || env.email.replyTo;
  if (reply) payload.reply_to = reply;

  const result = await request('POST', '/api/v1/email/send', payload);
  return {
    sent: result.sent !== false,
    messageId: result.message_id || result.messageId || null,
  };
}

/**
 * Send a bulk campaign in a single call — one subject/body fanned out to many
 * contacts, with `{{name|there}}`-style merge tags resolved per contact.
 * `consent` asserts the list opted in; the provider requires it.
 *
 * @param {object} opts
 * @param {string} opts.name      Campaign name shown in Mail Studio.
 * @param {string} opts.subject
 * @param {string} opts.html
 * @param {Array<{email:string,name?:string}>} opts.contacts
 * @param {boolean} [opts.consent]
 */
export async function sendCampaign({ name, subject, html, contacts, consent = true }) {
  if (!Array.isArray(contacts) || contacts.length === 0) {
    throw new MailApiError('At least one contact is required to send a campaign');
  }
  return request('POST', '/api/v1/campaigns/send', {
    name,
    subject,
    html,
    consent,
    contacts,
  });
}

/** Delivery progress for a campaign started with sendCampaign(). */
export async function getCampaignProgress(campaignId) {
  return request('GET', `/api/v1/campaigns/${encodeURIComponent(campaignId)}`);
}
