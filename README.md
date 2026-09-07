# @attensira/analytics

Edge/server client for [Attensira](https://attensira.com)'s AI traffic ingest —
`POST /v1/visits`.

## The whole install

```ts
event.waitUntil(trackPageHit('YOUR_PROJECT_ID', request));
```

Your project id is all you need. Nothing else is required to start recording.

Hand the promise to whatever keeps work alive past the response —
`event.waitUntil` in Next.js middleware, `ctx.waitUntil` in a Cloudflare
Worker. Calling it bare works, but an edge runtime may recycle the invocation
as soon as the response is returned and cancel the report in flight, which
looks exactly like no traffic.

## Breaking change in 1.0.0

Versions before 1.0.0 sent an unsigned `sendBeacon` from browser JavaScript to
`https://ingest.attensira.com/v1/crawler-logs`. That route no longer exists —
it was replaced by `/v1/visits`, which takes a different body — so nothing a
pre-1.0 install sent was ever recorded.

The browser was the deeper problem. **AI crawlers do not execute JavaScript.**
GPTBot, ClaudeBot, PerplexityBot and CCBot fetch a page and leave; by the time
an in-page script runs, the only visitors left are humans with browsers. A
browser beacon could not have seen a crawler even if the endpoint had existed.

1.0.0 is a rewrite against the endpoint that exists, called from the one layer
where a crawler request is visible at all: edge middleware, a CDN worker, or
any server-side runtime with `fetch` and `crypto.subtle`. There is no migration
that keeps the old browser usage — if you rendered `<AttensiraAnalytics />` or
called `trackPageHit()` client-side, replace it with the middleware pattern
below.

## Install

```bash
npm install @attensira/analytics
```

## Usage

### Next.js middleware

```ts
// middleware.ts
import type { NextFetchEvent, NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { trackPageHit } from '@attensira/analytics';

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  // waitUntil, not a bare call: without it the edge runtime may recycle the
  // invocation as soon as the response is returned, cancelling the report
  // mid-flight.
  event.waitUntil(trackPageHit('YOUR_PROJECT_ID', request));
  return NextResponse.next();
}

export const config = {
  // Pages, not assets. Every request that reaches this runs.
  matcher: ['/((?!_next|.*\\.(?:ico|png|svg|jpg|jpeg|webp|css|js)).*)'],
};
```

### Cloudflare Worker

```ts
import { trackPageHit } from '@attensira/analytics';

export default {
  async fetch(request, env, ctx) {
    const response = await fetch(request);
    ctx.waitUntil(trackPageHit(env.ATTENSIRA_PROJECT_ID, request));
    return response;
  },
};
```

## Scope it to pages

`trackPageHit` skips anything that is not a GET or HEAD, so form posts never
land in your page breakdown. Paths are yours to scope, because only you know
which of them are pages: if your middleware also runs for API routes, a
webhook, or a rewrite that proxies another vendor, exclude those before
calling — either in the framework's matcher, or with a guard:

```ts
const path = new URL(request.url).pathname;
if (!path.startsWith('/api')) {
  event.waitUntil(trackPageHit('YOUR_PROJECT_ID', request));
}
```

Otherwise `/api/subscribe` appears in the per-page breakdown beside your real
pages, which is the number the whole measurement exists to produce.

## Send everything — the service decides what is a bot

Report every request, humans included. Classification happens server-side
against a bot table Attensira can correct without anyone redeploying an edge
worker.

Filtering in your own code before sending is the mistake that makes a new
crawler invisible: whatever your filter has not heard of is exactly the traffic
you most wanted to find out about. Human hits are classified as such and cost
you nothing.

## Signing (optional)

A project with no write key provisioned is accepted unsigned — which is why a
project id alone is a working install. Once a write key *is* provisioned for
the project, the unsigned path closes: an unsigned body is then treated as a
forgery rather than an old client, and is refused.

```ts
trackPageHit(projectId, request, { writeKey: process.env.ATTENSIRA_WRITE_KEY });
```

`writeKey` defaults to `ATTENSIRA_WRITE_KEY` where `process.env` exists. It is
a server-side credential — never ship it to a browser bundle.

The signature is HMAC-SHA256, lowercase hex, over the bytes
`"<timestamp>.<body>"`, sent as two headers:

```
x-attensira-timestamp: <unix seconds>
x-attensira-signature: <hex hmac-sha256>
```

The timestamp is signed as well as sent, so it cannot be moved forward to
replay a captured body; ingest rejects a signature whose timestamp is more than
five minutes from its own clock. `signBody()` is unit-tested against a vector
produced by running the service's own Go verifier
(`internal/aitraffic/signature.go`) — not reimplemented from the spec.

## Privacy

The raw client address never leaves your infrastructure. `client_ip_hash` is a
SHA-256 digest salted with your project id, computed before the request is
sent, and the service re-hashes it with a salt that rotates daily — so a stored
value is not a stable identifier either.

## API

- **`trackPageHit(projectId, request, options?)`** → `Promise<void>`. Reports
  one page hit. Never throws and never rejects: a tracking failure must not
  break the request it is attached to. `options` is
  `{ writeKey?, endpoint?, fetch? }`.
- **`buildVisitBody(projectId, request)`** → the request body, for callers
  writing their own transport.
- **`signBody(writeKey, timestampSeconds, body)`** → the signature primitive,
  for writing an edge worker in a runtime this package does not run in.
- **`getClientIp(headers)`** → best-effort client address from
  `cf-connecting-ip`, `true-client-ip`, `x-real-ip`, or the first
  `x-forwarded-for` hop.
- **`hashClientIp(projectId, ip)`** → the `client_ip_hash` digest.

`request` is anything with `{ url, headers.get(name) }` — a `NextRequest`, a
WHATWG `Request`, or a Cloudflare Worker request all satisfy it, with no
adapter and no peer dependency.

## Local development

```bash
npm install
npm run build   # tsup -> dist/
npm test        # node's built-in test runner, TypeScript run directly
```
