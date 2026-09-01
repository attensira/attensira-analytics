# @attensira/analytics

Signed edge/server client for [Attensira](https://attensira.com)'s AI-crawler
traffic ingest — `POST /v1/visits` on the Attensira API.

## Breaking change in 1.0.0

Versions before 1.0.0 sent an unsigned `sendBeacon`/`fetch` page-hit to
`https://ingest.attensira.com/v1/crawler-logs` from browser JavaScript. That
host and endpoint were never served by Attensira's ingest API — nothing sent
by a pre-1.0 install was ever recorded, and AI crawlers don't execute
JavaScript in the first place, so a browser beacon would not have seen them
even if the endpoint had existed.

1.0.0 is a full rewrite against the endpoint that actually exists:
`POST https://api.attensira.com/v1/visits`, authenticated with an
[HMAC signature](#how-signing-works) instead of no authentication at all.
Because that signature is keyed by a per-project secret, **this package is
now server/edge-only and no longer has a browser entry point** — a secret
shipped to a browser bundle is a secret anyone viewing page source can read,
which would defeat the signature. There is no migration path that keeps the
old browser usage; if you rendered `<AttensiraAnalytics />` or called
`trackPageHit()` client-side, replace it with the middleware pattern below.

## Install

```bash
npm install @attensira/analytics
```

## Get your credentials

`projectId` and `signingSecret` come from `GET /v1/visits/install`, called
with your workspace's API key (see the Attensira dashboard). The response's
`signing_secret` field is the value to use here — it is already derived per
project; it is **not** your API key, and it is not any root key the webapp
holds. Keep it server-side, the same as any other credential (an environment
variable, a secrets store, a Worker secret — never committed, never sent to
a client).

## Usage

This package must run somewhere the signing secret can stay a secret: an
edge worker, server middleware, or a backend route. It does not ship a
browser build, and calling it from code that runs in the browser throws.

### Cloudflare Worker

```ts
import { createClient } from '@attensira/analytics';

const attensira = createClient({
  projectId: PROJECT_ID,
  signingSecret: env.ATTENSIRA_SIGNING_SECRET,
});

export default {
  async fetch(request, env, ctx) {
    const response = await fetch(request);
    // Fire-and-forget: never make a visitor wait on analytics.
    ctx.waitUntil(attensira.trackRequest(request));
    return response;
  },
};
```

### Next.js middleware

```ts
// middleware.ts
import { NextResponse } from 'next/server';
import { createClient } from '@attensira/analytics';

const attensira = createClient({
  projectId: process.env.ATTENSIRA_PROJECT_ID!,
  signingSecret: process.env.ATTENSIRA_SIGNING_SECRET!,
});

export function middleware(request: Request) {
  // Don't await in the request path; let it run after the response.
  attensira.trackRequest(request);
  return NextResponse.next();
}
```

### Any server route

```ts
import { createClient } from '@attensira/analytics';

const attensira = createClient({
  projectId: 'YOUR_PROJECT_ID',
  signingSecret: process.env.ATTENSIRA_SIGNING_SECRET!,
});

await attensira.sendVisits({
  pageUrl: 'https://example.com/blog/post',
  userAgent: request.headers['user-agent'],
  referrer: request.headers['referer'],
  clientIp: request.socket.remoteAddress,
});
```

`createClient()` called with no arguments reads `ATTENSIRA_PROJECT_ID`,
`ATTENSIRA_SIGNING_SECRET`, and optionally `ATTENSIRA_INGEST_ENDPOINT` from
`process.env`, for runtimes where that's available.

## API

- **`createClient(options?)`** — builds an `AttensiraClient`. `options` is
  `{ projectId, signingSecret, endpoint?, fetch? }`; omit it to read from
  `process.env` (see above).
- **`client.trackRequest(request, extra?)`** — derives a `Visit` from a
  standard `Request` (page URL, `user-agent`, `referer`, and a best-effort
  client IP from common proxy headers) and sends it. Never throws — logs and
  resolves to `undefined` on failure, so a tracking outage never breaks the
  request it's attached to.
- **`client.sendVisits(visit | visit[])`** — the lower-level call for when
  you already have the fields (e.g. server frameworks that don't hand you a
  `Request`). Up to 500 visits per call; batching beyond that is not chunked
  automatically. Throws on a network error or non-2xx response.
- **`getClientIp(headers)`** — best-effort real client IP from
  `cf-connecting-ip`, `true-client-ip`, `x-real-ip`, or the first hop of
  `x-forwarded-for`.
- **`signBody(signingSecret, timestampSeconds, body)`** — the signature
  primitive itself, exported for advanced use (writing an edge worker in a
  runtime this package doesn't run in, e.g. a language other than
  JS/TS — see [How signing works](#how-signing-works)).

### `Visit`

| Field        | Type     | Notes                                                                                   |
| ------------ | -------- | ---------------------------------------------------------------------------------------- |
| `pageUrl`    | `string` | Required.                                                                                 |
| `userAgent`  | `string` | Optional; used server-side to identify the crawler.                                      |
| `referrer`   | `string` | Optional.                                                                                 |
| `clientIp`   | `string` | The crawler's real connecting IP. Used to verify the user-agent's claim by reverse DNS, then hashed and discarded — never stored raw. Omit only if truly unavailable; without it the hit is recorded as unverified. |
| `timestamp`  | `Date`   | Optional; defaults to now.                                                               |

## How signing works

Every request carries an `X-Attensira-Signature` header:

```
X-Attensira-Signature: t=<unix seconds>,v1=<hex hmac-sha256>
```

The signed message is the literal bytes `"<t>.<body>"` (the decimal
timestamp, a period, then the exact JSON body bytes being sent), HMAC-SHA256
keyed by your project's signing secret, hex-encoded. The timestamp is
inside the signed payload — not just alongside it — so it can't be moved
forward to replay an old batch; the server rejects a signature whose
timestamp is more than 5 minutes from its own clock.

This matches the webapp's own verifier
(`internal/aitraffic/ingest.go`'s `verifySignature` / `projectSecret`)
exactly, including the choice to use the secret's characters directly as
the HMAC key rather than hex-decoding it first. `signBody()` is unit-tested
against a signature independently computed by that Go code — see the test
suite for the vector.

## client_ip and bot verification

`clientIp` is not just metadata: the server uses it to forward-confirm a
crawler's user-agent claim by reverse DNS (the same check Google and Bing
document for verifying their own crawlers), then hashes it and discards the
raw address — it is never stored. A `Visit` sent without `clientIp` is
recorded as unverified. `trackRequest()` fills this in automatically via
`getClientIp()`; if you call `sendVisits()` directly, pass the real
connecting IP for the request (not a value derived from a header a client
could spoof outside a trusted proxy).

## Local development

```bash
npm install
npm run build   # tsup -> dist/
npm test        # node's built-in test runner, TypeScript run directly
```
