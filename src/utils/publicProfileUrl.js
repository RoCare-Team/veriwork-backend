import { env } from '../config/env.js';

export function getPublicProfileBaseUrl() {
  return env.frontendUrl.replace(/\/$/, '');
}

/** URL path segment — publicSlug first, veriworkId as fallback. */
export function getPublicProfileIdentity(profile) {
  const identity = profile?.publicSlug?.trim() || profile?.veriworkId?.trim();
  return identity || '';
}

export function buildPublicProfileUrl(profile) {
  const base = getPublicProfileBaseUrl();
  const identity = getPublicProfileIdentity(profile);
  if (!base || !identity) return '';
  return `${base}/u/${encodeURIComponent(identity)}`;
}
