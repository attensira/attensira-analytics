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

/** `POST /v1/visits` on the ingest service. */
const DEFAULT_ENDPOINT = 'https://ingest.attensira.com/v1/visits';

/** Sent as `sdk_version` so ingest can attribute a malformed payload. */
export const SDK_VERSION = '@attensira/analytics/1.0.0';

/**
 * The subset of an inbound request this client reads. Structural on purpose:
 * a Next.js `NextRequest`, a WHATWG `Request` and a Cloudflare Worker request
 * all satisfy it without an adapter or a peer dependency.
 */
export type ServerRequest = {
  url: string;
  headers: { get(name: string): string | null };
};

export type TrackOptions = {
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
export type VisitBody = {
  project_id: string;
  sdk_version: string;
  page_url: string;
  user_agent?: string;
  referrer?: string;
  client_ip_hash?: string;
};

function readEnv(name: string): string | undefined {
  return typeof process !== 'undefined' ? process.env?.[name] : undefined;
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(input: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)));
}

/**
 * Header names platforms use to forward the real client address, in the order
 * they are trusted. `x-forwarded-for` may be a chain; only the first hop is
 * read.
 */
const CLIENT_IP_HEADERS = ['cf-connecting-ip', 'true-client-ip', 'x-real-ip'] as const;

/** Best-effort real client address from an inbound request's headers. */
export function getClientIp(headers: { get(name: string): string | null }): string {
  for (const name of CLIENT_IP_HEADERS) {
    const value = headers.get(name);
    if (value) return value.trim();
  }
  const forwardedFor = headers.get('x-forwarded-for');
  return forwardedFor?.split(',')[0]?.trim() ?? '';
}

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
export function hashClientIp(projectId: string, ip: string): Promise<string> {
  return sha256Hex(`${projectId}:${ip}`);
}

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
export async function signBody(
  writeKey: string,
  timestampSeconds: number,
  body: string
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(writeKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return toHex(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestampSeconds}.${body}`))
  );
}

/**
 * The public URL of the page that was read.
 *
 * `request.url` is the public URL on Vercel and Cloudflare, but behind a proxy
 * that terminates TLS and forwards to an internal origin it is the internal
 * one — so every row would record `http://localhost:3000/...` and the per-page
 * breakdown, which is the whole point of the measurement, would be unusable.
 * The forwarded headers win where the platform sets them.
 */
export function publicPageUrl(request: ServerRequest): string {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    // A relative or malformed url is still worth reporting as-is: the service
    // normalises what it can, and a dropped hit teaches us nothing.
    return request.url;
  }

  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  if (forwardedHost) {
    url.host = forwardedHost;
    // Assigning a bare hostname leaves any existing port in place, per the URL
    // spec, so a proxy fronting `localhost:3000` would otherwise record
    // `https://example.com:3000/...` — a different string from the real URL,
    // splitting one page into two rows.
    if (!forwardedHost.includes(':')) url.port = '';
  }

  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (forwardedProto) url.protocol = `${forwardedProto}:`;

  return url.toString();
}

/** Builds the request body for one page hit. Exported for tests and workers. */
export async function buildVisitBody(
  projectId: string,
  request: ServerRequest
): Promise<VisitBody> {
  const body: VisitBody = {
    project_id: projectId,
    sdk_version: SDK_VERSION,
    page_url: publicPageUrl(request),
  };

  const userAgent = request.headers.get('user-agent');
  if (userAgent) body.user_agent = userAgent;

  const referrer = request.headers.get('referer') ?? request.headers.get('referrer');
  if (referrer) body.referrer = referrer;

  const ip = getClientIp(request.headers);
  if (ip) body.client_ip_hash = await hashClientIp(projectId, ip);

  return body;
}

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
export async function trackPageHit(
  projectId: string | null | undefined,
  request: ServerRequest,
  options: TrackOptions = {}
): Promise<void> {
  try {
    if (!projectId) {
      console.error('[@attensira/analytics] projectId is required');
      return;
    }
    if (typeof window !== 'undefined') {
      // Not a silent return: calling this in the browser is the exact mistake
      // that made pre-1.0 installs report zero crawlers, and it has to be
      // loud enough to notice before it ships.
      console.error(
        '[@attensira/analytics] refusing to run in the browser: AI crawlers do not ' +
          'execute JavaScript, so an in-page call reports humans only. Call this from ' +
          'edge middleware or a server route instead.'
      );
      return;
    }
    if (!request) {
      console.error('[@attensira/analytics] a request is required for server-side tracking');
      return;
    }

    const body = JSON.stringify(await buildVisitBody(projectId, request));
    const headers: Record<string, string> = { 'content-type': 'application/json' };

    const writeKey = options.writeKey ?? readEnv('ATTENSIRA_WRITE_KEY');
    if (writeKey) {
      const timestamp = Math.floor(Date.now() / 1000);
      headers['x-attensira-timestamp'] = String(timestamp);
      headers['x-attensira-signature'] = await signBody(writeKey, timestamp, body);
    }

    const send = options.fetch ?? fetch;
    const response = await send(
      options.endpoint ?? readEnv('ATTENSIRA_INGEST_ENDPOINT') ?? DEFAULT_ENDPOINT,
      { method: 'POST', headers, body }
    );

    // A 4xx is a wiring mistake — wrong project id, wrong key, a schema that
    // moved — and it will not fix itself, so it is worth saying out loud. 429
    // and 5xx are ingest shedding load or having a bad minute; staying quiet
    // there keeps a transient outage out of the logs.
    if (!response.ok && response.status < 500 && response.status !== 429) {
      console.error(
        `[@attensira/analytics] visit rejected: ${response.status} ${response.statusText}`
      );
    }
  } catch (error) {
    console.error('[@attensira/analytics] failed to send page hit:', error);
  }
}

export default trackPageHit;
