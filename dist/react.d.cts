import { AttensiraOptions } from './index.cjs';

type AttensiraProps = {
    projectId: string;
    ingestUrl?: AttensiraOptions['ingestUrl'];
};
declare function Attensira({ projectId, ingestUrl }: AttensiraProps): null;

export { Attensira, type AttensiraProps, Attensira as default };
