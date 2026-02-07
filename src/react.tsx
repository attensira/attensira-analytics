import { useEffect } from 'react';
import { trackPageHit } from './index';

export type AttensiraProps = {
  projectId: string;
};

/**
 * React component for tracking page hits with Attensira Analytics.
 * 
 * This component only tracks in the browser. During server-side rendering,
 * it will safely do nothing. For server-side tracking (e.g., crawler logs),
 * call trackPageHit() directly in your server code with a request object.
 */
export function AttensiraAnalytics({ projectId }: AttensiraProps) {
  useEffect(() => {
    // Only track in the browser (not during SSR)
    if (typeof window === 'undefined') return;
    
    trackPageHit(projectId);
  }, [projectId]);

  return null;
}

export default AttensiraAnalytics;
