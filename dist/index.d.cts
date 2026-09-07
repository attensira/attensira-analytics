/**
 * @attensira/analytics — edge/server client for Attensira's AI traffic ingest.
 *
 * ## Why this package is not a browser script
 *
 * AI crawlers do not execute JavaScript. GPTBot, ClaudeBot, PerplexityBot and
 * CCBot fetch a page and leave; by the time any in-page script runs, the only
 * visitors left are humans with browsers. Versions before 1.0.0 were a
 * `sendBeacon` from the browser, so they measured every visitor *except* the
 * ones this product exists to count — and sent them to `/v1/crawler-logs`,
 * a route the ingest service no longer serves. Nothing a pre-1.0 install sent
 * was ever recorded.
 *
 * 1.0.0 is a rewrite against `POST /v1/visits` on the ingest service, called
 * from the one layer where a crawler request exists to be seen: edge
 * middleware, a CDN worker, or any server-side runtime with `fetch` and
 * `crypto.subtle`.
 *
 * ## The whole install
 *
 * ```ts
 * trackPageHit(projectId, request);
 * ```
 *
 * A project id is all that is required. Signing is an additional defence that
 * turns on by itself once a write key is provisioned for the project — see
 * `options.writeKey`.
 *
 * ## What it deliberately does not do
 *
 * It does not decide what is a bot. Every request handed to it is reported,
 * humans included, and the ingest service classifies the user agent against a
 * table it can correct without anyone redeploying an edge worker. A client
 * that filtered first would be a second, stale copy of that table, and the
 * crawler it had not heard of would be the one that went unrecorded.
 */
/** Sent as `sdk_version` so ingest can attribute a malformed payload. */
declare const SDK_VERSION = "@attensira/analytics/1.0.0";
/**
 * The subset of an inbound request this client reads. Structural on purpose:
 * a Next.js `NextRequest`, a WHATWG `Request` and a Cloudflare Worker request
 * all satisfy it without an adapter or a peer dependency.
 */
type ServerRequest = {
    url: string;
    headers: {
        get(name: string): string | null;
    };
    /**
     * Optional. When present, only GET and HEAD are reported: a POST is a form
     * submission, not a page read, and no crawler fetches a page with one.
     * Recording them puts `/api/subscribe` in the per-page breakdown next to
     * real pages.
     */
    method?: string;
};
type TrackOptions = {
    /**
     * The project's HMAC write key. Optional: a project with no key provisioned
     * is accepted unsigned, which is what makes a project id alone a working
     * install. Once ingest has a key for the project the unsigned path closes —
     * an unsigned body is then a forgery, not an old client — so this must be
     * set wherever that project reports from.
     *
     * Defaults to `ATTENSIRA_WRITE_KEY` where `process.env` exists. It is a
     * server-side credential: never ship it to a browser bundle.
     */
    writeKey?: string;
    /** Override for staging or self-hosted ingest. Defaults to `ATTENSIRA_INGEST_ENDPOINT`, then production. */
    endpoint?: string;
    /** Injection point for tests; defaults to the global `fetch`. */
    fetch?: typeof fetch;
};
/** The body of `POST /v1/visits`. Flat, exactly as the service declares it. */
type VisitBody = {
    project_id: string;
    sdk_version: string;
    page_url: string;
    user_agent?: string;
    referrer?: string;
    client_ip_hash?: string;
};
/** Best-effort real client address from an inbound request's headers. */
declare function getClientIp(headers: {
    get(name: string): string | null;
}): string;
/**
 * Hashes a client address for `client_ip_hash`.
 *
 * The raw address never leaves the caller's own infrastructure: it is not in
 * the request body, so it reaches neither our logs nor anything between. The
 * service re-hashes this digest with a salt that rotates daily, so a stored
 * value is not a stable identifier either — but that rotation cannot undo an
 * address we were sent, which is why the hashing happens here.
 *
 * Salted with the project id so one visitor's digest cannot be matched across
 * projects.
 */
declare function hashClientIp(projectId: string, ip: string): Promise<string>;
/**
 * The `x-attensira-signature` value: lowercase hex HMAC-SHA256 over the bytes
 * `"<timestamp>.<body>"`, keyed by the write key's own characters.
 *
 * This mirrors `VerifyRequestSignature` in the ingest service byte for byte —
 * same algorithm, same encoding, and the same signed-string construction (Go
 * writes `timestamp + "."` and then the raw body into one HMAC, which is the
 * same stream as `` `${t}.${body}` ``). The timestamp travels in its own
 * `x-attensira-timestamp` header but is signed too, so it cannot be moved
 * forward to replay a captured body; ingest rejects one more than five
 * minutes from its clock.
 */
declare function signBody(writeKey: string, timestampSeconds: number, body: string): Promise<string>;
/**
 * The public URL of the page that was read.
 *
 * `request.url` is the public URL on Vercel and Cloudflare, but behind a proxy
 * that terminates TLS and forwards to an internal origin it is the internal
 * one — so every row would record `http://localhost:3000/...` and the per-page
 * breakdown, which is the whole point of the measurement, would be unusable.
 * The forwarded headers win where the platform sets them.
 */
declare function publicPageUrl(request: ServerRequest): string;
/** Builds the request body for one page hit. Exported for tests and workers. */
declare function buildVisitBody(projectId: string, request: ServerRequest): Promise<VisitBody>;
/**
 * Reports one page hit.
 *
 * Never throws and never rejects: a tracking failure must not break the
 * request it is attached to. Call it fire-and-forget, handing the promise to
 * whatever keeps work alive past the response — `event.waitUntil(...)` in
 * Next.js middleware, `ctx.waitUntil(...)` in a Cloudflare Worker. Without
 * that the runtime may recycle the invocation the moment the response is
 * returned, cancelling the report mid-flight.
 *
 * ```ts
 * event.waitUntil(trackPageHit('YOUR_PROJECT_ID', request));
 * ```
 */
declare function trackPageHit(projectId: string | null | undefined, request: ServerRequest, options?: TrackOptions): Promise<void>;

export { SDK_VERSION, type ServerRequest, type TrackOptions, type VisitBody, buildVisitBody, trackPageHit as default, getClientIp, hashClientIp, publicPageUrl, signBody, trackPageHit };
