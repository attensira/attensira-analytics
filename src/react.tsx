import { useEffect } from 'react';
import { trackPageHit } from './index';

export type AttensiraProps = {
  projectId: string;
};

export function AttensiraAnalytics({ projectId }: AttensiraProps) {
  useEffect(() => {
    trackPageHit(projectId);
  }, [projectId]);

  return null;
}

export default AttensiraAnalytics;
