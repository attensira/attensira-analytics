type AttensiraProps = {
    projectId: string;
};
/**
 * React component for tracking page hits with Attensira Analytics.
 *
 * This component only tracks in the browser. During server-side rendering,
 * it will safely do nothing. For server-side tracking (e.g., crawler logs),
 * call trackPageHit() directly in your server code with a request object.
 */
declare function AttensiraAnalytics({ projectId }: AttensiraProps): null;

export { AttensiraAnalytics, type AttensiraProps, AttensiraAnalytics as default };
