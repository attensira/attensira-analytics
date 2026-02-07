export { AttensiraAnalytics, AttensiraProps, AttensiraAnalytics as default } from './react.cjs';

type ServerRequest = {
    url: string;
    headers: {
        get(name: string): string | null;
        [key: string]: any;
    };
};
declare function trackPageHit(projectId: string | null | undefined, request?: ServerRequest): void;

export { trackPageHit };
