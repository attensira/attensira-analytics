declare const ATTENSIRA_DEFAULT_INGEST_URL = "https://ingest.attensira.com/v1/crawler-logs";
type AttensiraOptions = {
    ingestUrl?: string;
};
/**
 * Collects basic page-hit data from the browser and sends it to the
 * Attensira ingest API. Safe to call multiple times; duplicate calls
 * for the same projectId + href are ignored.
 */
declare function trackPageHit(projectId: string, options?: AttensiraOptions): Promise<void>;

export { ATTENSIRA_DEFAULT_INGEST_URL, type AttensiraOptions, trackPageHit };
