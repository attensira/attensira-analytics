const INGEST_URL = 'https://ingest.attensira.com/v1/crawler-logs';

const sent = new Set<string>();

/**
 * Collects basic page-hit data from the browser and sends it to the
 * Attensira ingest API. Safe to call multiple times; duplicate calls
 * for the same projectId + href are ignored.
 */
export function trackPageHit(projectId: string): void {
  if (!projectId || typeof window === 'undefined') return;

  const href = window.location.href;
  const dedupeKey = `${projectId}:${href}`;
  if (sent.has(dedupeKey)) return;
  sent.add(dedupeKey);

  const payload = JSON.stringify({
    project_id: projectId,
    action: 'page_hit',
    payload: {
      href,
      referrer: document.referrer || '',
      user_agent: navigator.userAgent,
      locale: navigator.language || '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    },
  });

  navigator.sendBeacon(INGEST_URL, new Blob([payload], { type: 'application/json' }));
}

export { AttensiraAnalytics, type AttensiraProps } from './react';
export { AttensiraAnalytics as default } from './react';
