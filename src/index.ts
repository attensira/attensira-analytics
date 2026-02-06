export const ATTENSIRA_DEFAULT_INGEST_URL =
  'https://ingest.attensira.com/v1/crawler-logs';

export type AttensiraOptions = {
  ingestUrl?: string;
};

const sent = new Set<string>();

/**
 * Collects basic page-hit data from the browser and sends it to the
 * Attensira ingest API. Safe to call multiple times; duplicate calls
 * for the same projectId + href are ignored.
 */
export function trackPageHit(
  projectId: string,
  options: AttensiraOptions = {}
): Promise<void> {
  if (!projectId || typeof projectId !== 'string') {
    return Promise.reject(new Error('projectId is required'));
  }

  if (typeof window === 'undefined') {
    return Promise.resolve();
  }

  const href = window.location.href;
  const dedupeKey = `${projectId}:${href}`;
  if (sent.has(dedupeKey)) {
    return Promise.resolve();
  }
  sent.add(dedupeKey);

  const payload = {
    project_id: projectId,
    action: 'page_hit',
    payload: {
      href,
      referrer: document.referrer || '',
      user_agent: navigator.userAgent,
      locale: navigator.language || '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    },
  };

  const url = options.ingestUrl || ATTENSIRA_DEFAULT_INGEST_URL;

  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }).then(() => undefined);
}
