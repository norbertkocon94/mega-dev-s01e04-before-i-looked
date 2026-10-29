import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const configFor = (runsDir: string) => ({
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir,
});

function decodeHtml(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'");
}

function digestTableRows(html: string): string[][] {
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1];
  if (!body) return [];

  return [...body.matchAll(/<tr(?:\s[^>]*)?>([\s\S]*?)<\/tr>/g)].map(([, row]) =>
    [...row.matchAll(/<td>([\s\S]*?)<\/td>/g)].map(([, cell]) => decodeHtml(cell)),
  );
}

describe('digest routes', () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = fs.mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  });

  afterEach(() => {
    fs.rmSync(runsDir, { recursive: true, force: true });
  });

  function writeNight(night: string, contents: string): void {
    fs.writeFileSync(join(runsDir, `${night}.jsonl`), contents);
  }

  it('serves sorted, matching HTML and JSON rows and exposes counts on the board', async () => {
    const night = '2026-10-28';
    writeNight(night, [
      // Intentionally out of order: the original offsets and chronological recovery matter.
      JSON.stringify({ at: '2026-10-28T23:00:00+01:00', job: 'zeta', status: 'ok', owner: 'rook' }),
      JSON.stringify({ at: '2026-10-28T22:00:00Z', job: 'alpha', status: 'fail', owner: 'rook', error: '<script>bad()</script> & "quoted"' }),
      JSON.stringify({ at: '2026-10-28T20:00:00+01:00', job: 'zeta', status: 'retry', owner: 'rook', error: 'temporary outage' }),
      JSON.stringify({ at: '2026-10-28T23:30:00+01:00', job: 'alpha', status: 'ok', owner: null }),
      JSON.stringify({ at: '2026-10-28T21:00:00+01:00', job: 'zeta', status: 'retry', owner: 'rook' }),
      JSON.stringify({ at: '2026-10-28T21:30:00+01:00', job: 'zeta', status: 'retry', owner: 'rook' }),
    ].join('\n'));

    const app = createApp(configFor(runsDir));
    const [htmlResponse, jsonResponse] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);
    const html = await htmlResponse.text();
    const digest = await jsonResponse.json();

    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    expect(digest).toEqual({
      badLines: 0,
      counts: { ok: 2, retry: 3, fail: 1 },
      rows: [
        {
          job: 'alpha', owner: null, runs: 2, retries: 0, lastStatus: 'ok',
          lastError: '<script>bad()</script> & "quoted"', hasFailure: true,
          firstAt: '2026-10-28T22:00:00Z', lastAt: '2026-10-28T23:30:00+01:00',
        },
        {
          job: 'zeta', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok',
          lastError: 'temporary outage', hasFailure: false,
          firstAt: '2026-10-28T20:00:00+01:00', lastAt: '2026-10-28T23:00:00+01:00',
        },
      ],
    });

    const rows = digestTableRows(html);
    expect(rows).toEqual([
      ['alpha', '—', '2', '0', 'ok', '<script>bad()</script> & "quoted"', '2026-10-28T22:00:00Z', '2026-10-28T23:30:00+01:00'],
      ['zeta', 'rook', '4', '3', 'ok', 'temporary outage', '2026-10-28T20:00:00+01:00', '2026-10-28T23:00:00+01:00'],
    ]);
    expect(rows.map(([job]) => job)).toEqual(digest.rows.map((row: { job: string }) => row.job));
    expect(digest.rows[0].owner).toBeNull();
    expect([...html.matchAll(/<tr class="warn">/g)]).toHaveLength(2);
    expect(html).toContain('&lt;script&gt;bad()&lt;/script&gt; &amp; &quot;quoted&quot;');
    expect(html).not.toMatch(/<script\b/i);

    const boardResponse = await app.request('/');
    const board = await boardResponse.text();
    expect(boardResponse.status).toBe(200);
    expect(board).toContain(`<a href="/digest/${night}">${night}</a>`);
    expect(board).toContain('ok 2 · retry 3 · fail 1');

    // Include a second on-disk night so the board's link/count summary covers each fixture.
    writeNight('2026-10-27', JSON.stringify({ at: '2026-10-27T06:00:00-04:00', job: 'backup', status: 'fail', owner: null }));
    const twoNightBoard = await (await app.request('/')).text();
    expect(twoNightBoard).toContain('<a href="/digest/2026-10-27">2026-10-27</a>');
    expect(twoNightBoard).toContain('ok 0 · retry 0 · fail 1');
  });

  it('returns 404 for missing nights on both endpoints', async () => {
    const app = createApp(configFor(runsDir));
    const [html, json] = await Promise.all([
      app.request('/digest/2026-10-28'),
      app.request('/api/digest/2026-10-28'),
    ]);

    expect(html.status).toBe(404);
    expect(json.status).toBe(404);
  });

  it('returns an empty digest for an existing empty file', async () => {
    const night = '2026-10-28';
    writeNight(night, '');
    const app = createApp(configFor(runsDir));
    const [html, json] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);

    expect(html.status).toBe(200);
    expect(await html.text()).toContain('nothing ran');
    expect(json.status).toBe(200);
    expect(await json.json()).toEqual({
      rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('counts malformed JSON and schema lines while rendering surviving events', async () => {
    const night = '2026-10-28';
    writeNight(night, [
      '{not json',
      JSON.stringify({ at: '2026-10-28T08:00:00Z', job: 'invalid-owner', status: 'ok', owner: 7 }),
      JSON.stringify({ at: '2026-10-28T09:00:00-04:00', job: 'survivor', status: 'ok', owner: null }),
    ].join('\n'));
    const app = createApp(configFor(runsDir));
    const html = await app.request(`/digest/${night}`);
    const json = await app.request(`/api/digest/${night}`);

    expect(html.status).toBe(200);
    const htmlText = await html.text();
    expect(htmlText).toContain('malformed lines: 2');
    expect(digestTableRows(htmlText)).toEqual([
      ['survivor', '—', '1', '0', 'ok', '—', '2026-10-28T09:00:00-04:00', '2026-10-28T09:00:00-04:00'],
    ]);
    expect(json.status).toBe(200);
    expect(await json.json()).toEqual({
      badLines: 2,
      counts: { ok: 1, retry: 0, fail: 0 },
      rows: [{
        job: 'survivor', owner: null, runs: 1, retries: 0, lastStatus: 'ok',
        lastError: null, hasFailure: false,
        firstAt: '2026-10-28T09:00:00-04:00', lastAt: '2026-10-28T09:00:00-04:00',
      }],
    });
  });
});
