import { useEffect } from 'react';
import { trackPageHit, type AttensiraOptions } from './index';

export type AttensiraProps = {
  projectId: string;
  ingestUrl?: AttensiraOptions['ingestUrl'];
};

export function Attensira({ projectId, ingestUrl }: AttensiraProps) {
  useEffect(() => {
    trackPageHit(projectId, { ingestUrl });
  }, [projectId, ingestUrl]);

  return null;
}

export default Attensira;
