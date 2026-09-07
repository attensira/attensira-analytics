import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  buildVisitBody,
  getClientIp,
  publicPageUrl,
  hashClientIp,
  SDK_VERSION,
  signBody,
  trackPageHit,
} from './index.ts';

/**
 * Known-good vector, verified by running the ingest service's OWN
 * `VerifyRequestSignature` (attensira/ingest,
 * src/internal/aitraffic/signature.go) against this signature as a Go test —
 * not reimplemented here from the spec. A byte-for-byte match is what tells
 * us the service will actually accept what this client sends.
 *
 *   VerifyRequestSignature(lookup, projectID, timestamp, signature, body, now)
 *     -> true   (and false for the same body with one byte appended)
 */
const GO_VECTOR = {
  writeKey: 'test-write-key',
  timestampSeconds: 1700000000,
  body:
    '{"project_id":"6874ec7964e95aa3e46ab36a","sdk_version":"@attensira/analytics/1.0.0",' +
    '"page_url":"https://attensira.com/pricing","user_agent":"GPTBot/1.2","client_ip_hash":"a1b2c3"}',
  expected: '52cb3b205c8a18df43be2f34848f1f572e1f33a7815a8019639f02292d6b222c',
};

function makeRequest(url: string, headers: Record<string, string> = {}) {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { url, headers: { get: (name: string) => lower.get(name.toLowerCase()) ?? null } };
}

function mockFetch(response: Partial<Response> = {}) {
  const calls: Array<[string, RequestInit]> = [];
  const impl = (async (url: unknown, init: unknown) => {
    calls.push([String(url), init as RequestInit]);
    return { ok: true, status: 202, statusText: 'Accepted', ...response } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

// -- signing ------------------------------------------------------------------

test('signBody matches the Go verifier byte-for-byte', async () => {
  const signature = await signBody(
    GO_VECTOR.writeKey,
    GO_VECTOR.timestampSeconds,
    GO_VECTOR.body
  );
  assert.equal(signature, GO_VECTOR.expected);
});

test('signBody is bare lowercase hex, with no t=/v1= framing', async () => {
  // The ingest service reads the timestamp from its own header and hex-decodes
  // the signature directly. A "t=...,v1=..." value fails there.
  assert.match(await signBody('secret', 42, '{}'), /^[0-9a-f]{64}$/);
});

test('signBody is sensitive to key, timestamp and body alike', async () => {
  const base = await signBody('secret', 100, '{"a":1}');
  assert.notEqual(base, await signBody('other', 100, '{"a":1}'));
  assert.notEqual(base, await signBody('secret', 101, '{"a":1}'));
  assert.notEqual(base, await signBody('secret', 100, '{"a":2}'));
  assert.equal(base, await signBody('secret', 100, '{"a":1}'));
});

// -- client ip ----------------------------------------------------------------

test('getClientIp prefers cf-connecting-ip over the forwarded chain', () => {
  const request = makeRequest('https://x/', {
    'cf-connecting-ip': '1.1.1.1',
    'x-forwarded-for': '2.2.2.2, 3.3.3.3',
  });
  assert.equal(getClientIp(request.headers), '1.1.1.1');
});

test('getClientIp falls back to the first forwarded hop', () => {
  const request = makeRequest('https://x/', { 'x-forwarded-for': '2.2.2.2, 3.3.3.3' });
  assert.equal(getClientIp(request.headers), '2.2.2.2');
});

test('getClientIp is empty when no address is forwarded', () => {
  assert.equal(getClientIp(makeRequest('https://x/').headers), '');
});

test('hashClientIp is per-project, so one visitor cannot be joined across projects', async () => {
  const a = await hashClientIp('project-aaaa', '203.0.113.7');
  const b = await hashClientIp('project-bbbb', '203.0.113.7');
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
  assert.ok(!a.includes('203'));
});

// -- body ---------------------------------------------------------------------

test('buildVisitBody produces the flat shape POST /v1/visits declares', async () => {
  const body = await buildVisitBody(
    '6874ec7964e95aa3e46ab36a',
    makeRequest('https://attensira.com/pricing', {
      'user-agent': 'ClaudeBot/1.0',
      referer: 'https://claude.ai/',
      'x-forwarded-for': '203.0.113.7',
    })
  );

  assert.equal(body.project_id, '6874ec7964e95aa3e46ab36a');
  assert.equal(body.page_url, 'https://attensira.com/pricing');
  assert.equal(body.user_agent, 'ClaudeBot/1.0');
  assert.equal(body.referrer, 'https://claude.ai/');
  assert.match(body.client_ip_hash!, /^[0-9a-f]{64}$/);

  // The pre-1.0 envelope. If either of these returns the service rejects the
  // body as missing page_url — silently, because ingest answers 202 first.
  assert.equal('action' in body, false);
  assert.equal('payload' in body, false);
});

test('the raw client address never appears in the body', async () => {
  const body = await buildVisitBody(
    'proj_test1234',
    makeRequest('https://attensira.com/', { 'x-forwarded-for': '203.0.113.7' })
  );
  assert.ok(!JSON.stringify(body).includes('203.0.113.7'));
});

test('publicPageUrl prefers the forwarded host over an internal origin', () => {
  const request = makeRequest('http://localhost:3000/blog/geo', {
    'x-forwarded-host': 'attensira.com',
    'x-forwarded-proto': 'https',
  });
  // Note the internal port is gone: a stale :3000 would split one page in two.
  assert.equal(publicPageUrl(request), 'https://attensira.com/blog/geo');
});

test('publicPageUrl clears the internal port for a bracketed IPv6 host', () => {
  // An IPv6 authority is all colons, so "has a colon" is not "has a port".
  const request = makeRequest('http://localhost:3000/page', {
    'x-forwarded-host': '[2001:db8::1]',
    'x-forwarded-proto': 'https',
  });
  assert.equal(publicPageUrl(request), 'https://[2001:db8::1]/page');
});

test('publicPageUrl keeps an explicit IPv6 port', () => {
  const request = makeRequest('http://localhost:3000/page', {
    'x-forwarded-host': '[2001:db8::1]:8443',
    'x-forwarded-proto': 'https',
  });
  assert.equal(publicPageUrl(request), 'https://[2001:db8::1]:8443/page');
});

test('publicPageUrl keeps the path and query that identify the page', () => {
  assert.equal(
    publicPageUrl(makeRequest('https://attensira.com/blog?page=2')),
    'https://attensira.com/blog?page=2'
  );
});

test('publicPageUrl passes through a url it cannot parse', () => {
  assert.equal(publicPageUrl(makeRequest('/pricing')), '/pricing');
});

test('SDK_VERSION tracks the published package version', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(SDK_VERSION, `@attensira/analytics/${pkg.version}`);
});

// -- trackPageHit -------------------------------------------------------------

test('a project id alone is a working install: unsigned, to /v1/visits', async () => {
  const { impl, calls } = mockFetch();
  await trackPageHit(
    '6874ec7964e95aa3e46ab36a',
    makeRequest('https://attensira.com/blog', { 'user-agent': 'GPTBot/1.2' }),
    { fetch: impl }
  );

  assert.equal(calls.length, 1);
  const [url, init] = calls[0];
  assert.equal(url, 'https://ingest.attensira.com/v1/visits');
  assert.equal(init.method, 'POST');
  // Unsigned is the point: ingest accepts a project with no write key
  // provisioned, which is what makes this a one-line install.
  const headers = init.headers as Record<string, string>;
  assert.equal('x-attensira-signature' in headers, false);
  assert.equal(JSON.parse(String(init.body)).page_url, 'https://attensira.com/blog');
});

test('a write key switches on signing, in the two headers ingest reads', async () => {
  const { impl, calls } = mockFetch();
  await trackPageHit('6874ec7964e95aa3e46ab36a', makeRequest('https://attensira.com/'), {
    writeKey: 'test-write-key',
    fetch: impl,
  });

  const headers = calls[0][1].headers as Record<string, string>;
  const timestamp = Number(headers['x-attensira-timestamp']);
  assert.equal(
    headers['x-attensira-signature'],
    await signBody('test-write-key', timestamp, String(calls[0][1].body))
  );
  // Five minutes of skew is all the service allows.
  assert.ok(Math.abs(Date.now() / 1000 - timestamp) < 60);
});

test('every request is reported; the service decides what is a bot', async () => {
  const { impl, calls } = mockFetch();
  const chrome =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  await trackPageHit('proj_test1234', makeRequest('https://attensira.com/', {
    'user-agent': chrome,
  }), { fetch: impl });

  // Filtering here would be a second, stale copy of the service's bot table,
  // and the crawler it had not heard of is the one that would go missing.
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(String(calls[0][1].body)).user_agent, chrome);
});

test('a form submission is not a page read', async () => {
  const { impl, calls } = mockFetch();
  const post = { ...makeRequest('https://attensira.com/api/waitlist'), method: 'POST' };
  await trackPageHit('proj_test1234', post, { fetch: impl });
  assert.equal(calls.length, 0);
});

test('GET and HEAD are both reported', async () => {
  const { impl, calls } = mockFetch();
  for (const method of ['GET', 'HEAD', 'get']) {
    await trackPageHit(
      'proj_test1234',
      { ...makeRequest('https://attensira.com/'), method },
      { fetch: impl }
    );
  }
  assert.equal(calls.length, 3);
});

test('a request object with no method is still reported', async () => {
  const { impl, calls } = mockFetch();
  await trackPageHit('proj_test1234', makeRequest('https://attensira.com/'), { fetch: impl });
  assert.equal(calls.length, 1);
});

test('an endpoint override is honoured for staging', async () => {
  const { impl, calls } = mockFetch();
  await trackPageHit('proj_test1234', makeRequest('https://x/'), {
    endpoint: 'http://127.0.0.1:4599/v1/visits',
    fetch: impl,
  });
  assert.equal(calls[0][0], 'http://127.0.0.1:4599/v1/visits');
});

test('a missing project id reports nothing rather than posting junk', async () => {
  const { impl, calls } = mockFetch();
  await trackPageHit(undefined, makeRequest('https://x/'), { fetch: impl });
  assert.equal(calls.length, 0);
});

test('never rejects when ingest is unreachable', async () => {
  const failing = (async () => {
    throw new Error('network down');
  }) as unknown as typeof fetch;
  await assert.doesNotReject(
    trackPageHit('proj_test1234', makeRequest('https://x/'), { fetch: failing })
  );
});

test('never rejects when ingest returns an error status', async () => {
  const { impl } = mockFetch({ ok: false, status: 404, statusText: 'Not Found' });
  await assert.doesNotReject(
    trackPageHit('proj_test1234', makeRequest('https://x/'), { fetch: impl })
  );
});
