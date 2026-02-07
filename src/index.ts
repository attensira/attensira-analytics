const INGEST_URL = 'https://ingest.attensira.com/v1/crawler-logs';


type ServerRequest = {
  url: string;
  headers: {
    get(name: string): string | null;
    [key: string]: any;
  };
};

export function trackPageHit(
  projectId: string | null | undefined,
  request?: ServerRequest
): void {
  const isBrowser = typeof window !== 'undefined';
  
  // Validate projectId
  if (!projectId) {
    if (isBrowser) {
      console.error('[Attensira Analytics] projectId is required');
    }
    return;
  }

  // Browser-side tracking
  if (isBrowser) {
    const href = window.location.href;
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
    return;
  }

  // Server-side tracking
  if (request) {
    const href = request.url;
    const userAgent = request.headers.get('user-agent') || '';
    const referer = request.headers.get('referer') || request.headers.get('referrer') || '';
    const acceptLanguage = request.headers.get('accept-language') || '';

    const payload = JSON.stringify({
      project_id: projectId,
      action: 'page_hit',
      payload: {
        href,
        referrer: referer,
        user_agent: userAgent,
        locale: acceptLanguage.split(',')[0]?.trim() || '',
      },
    });

    // Use fetch for server-side (sendBeacon is browser-only)
    fetch(INGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    }).catch((error) => {
      console.error('[Attensira Analytics] Failed to send page hit:', error);
    });
  }
}

export { AttensiraAnalytics, type AttensiraProps } from './react';
export { AttensiraAnalytics as default } from './react';
