export { AttensiraAnalytics, AttensiraProps, AttensiraAnalytics as default } from './react.js';

/**
 * Collects basic page-hit data from the browser and sends it to the
 * Attensira ingest API. Safe to call multiple times; duplicate calls
 * for the same projectId + href are ignored.
 */
declare function trackPageHit(projectId: string): void;

export { trackPageHit };
