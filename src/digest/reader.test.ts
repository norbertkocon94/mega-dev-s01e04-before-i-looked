import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readNight } from './reader.js';

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

const night = '2026-10-28';
const empty = { rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
const event = { at: '2026-10-28T23:00:00+01:00', job: 'job', status: 'ok', owner: 'rook' };

describe('readNight', () => {
  let runsDir: string;

  beforeEach(() => {
    vi.mocked(fs.readFileSync).mockReset();
    runsDir = fs.mkdtempSync(join(tmpdir(), 'rig-reader-'));
  });

  afterEach(() => {
    fs.rmSync(runsDir, { recursive: true, force: true });
  });

  function writeEvents(events: unknown[]) {
    fs.writeFileSync(join(runsDir, `${night}.jsonl`), events.map(value => JSON.stringify(value)).join('\n'));
  }

  it('aggregates the supplied night, including cross-midnight events and its bad line', () => {
    const suppliedRuns = fileURLToPath(new URL('../../runs/', import.meta.url));
    expect(readNight(suppliedRuns, night)).toEqual({
      badLines: 1,
      counts: { ok: 10, retry: 4, fail: 1 },
      rows: [
        {
          job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok',
          lastError: null, hasFailure: false,
          firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00',
        },
        {
          job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok',
          lastError: 'upstream 503', hasFailure: false,
          firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
        },
        {
          job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, lastStatus: 'ok',
          lastError: 'lock held', hasFailure: false,
          firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00',
        },
        {
          job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'fail',
          lastError: 'quota exceeded', hasFailure: true,
          firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00',
        },
        {
          job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'ok',
          lastError: null, hasFailure: false,
          firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00',
        },
      ],
    });
  });

  it('returns null for a missing file or missing directory', () => {
    expect(readNight(runsDir, night)).toBeNull();
    expect(readNight(join(runsDir, 'missing'), night)).toBeNull();
  });

  it.each(['', ' \n\t\r\n'])('returns zero counts for an empty or blank file (%j)', contents => {
    fs.writeFileSync(join(runsDir, `${night}.jsonl`), contents);
    expect(readNight(runsDir, night)).toEqual(empty);
  });

  it('counts malformed nonblank lines once and continues parsing the file', () => {
    fs.writeFileSync(join(runsDir, `${night}.jsonl`), `broken\r\n \r\n${JSON.stringify(event)}\r\n{"at":\n[]\n`);
    expect(readNight(runsDir, night)).toMatchObject({
      badLines: 3, counts: { ok: 1, retry: 0, fail: 0 }, rows: [{ job: 'job', runs: 1 }],
    });
  });

  it.each([
    ['null', null],
    ['array', []],
    ['string', 'event'],
    ['number', 7],
    ['boolean', true],
    ['empty object', {}],
    ['missing owner', { at: event.at, job: event.job, status: event.status }],
    ['numeric owner', { ...event, owner: 1 }],
    ['object owner', { ...event, owner: {} }],
    ['blank job', { ...event, job: ' \t' }],
    ['non-string job', { ...event, job: 1 }],
    ['unknown status', { ...event, status: 'OK' }],
    ['non-string status', { ...event, status: null }],
    ['non-string error', { ...event, error: 42 }],
    ['array error', { ...event, error: [] }],
    ['non-string timestamp', { ...event, at: 123 }],
    ['unparseable timestamp', { ...event, at: 'yesterday' }],
    ['no timezone', { ...event, at: '2026-10-28T23:00:00' }],
    ['date only', { ...event, at: '2026-10-28' }],
    ['non-ISO date', { ...event, at: 'October 28, 2026 23:00:00 GMT' }],
    ['impossible date', { ...event, at: '2026-02-30T23:00:00Z' }],
    ['impossible time', { ...event, at: '2026-10-28T25:00:00Z' }],
    ['impossible offset', { ...event, at: '2026-10-28T23:00:00+25:00' }],
    ['offset without colon', { ...event, at: '2026-10-28T23:00:00+0100' }],
  ])('excludes schema-invalid input: %s', (_label, value) => {
    writeEvents([value]);
    expect(readNight(runsDir, night)).toEqual({ ...empty, badLines: 1 });
  });

  it('accepts null owners, optional/null errors and unknown fields without changing job names', () => {
    writeEvents([
      { ...event, job: ' job ', owner: null, error: null, extra: { ignored: true } },
      { ...event, job: 'job', owner: '' },
    ]);
    expect(readNight(runsDir, night)).toMatchObject({
      badLines: 0, counts: { ok: 2, retry: 0, fail: 0 },
      rows: [
        { job: ' job ', owner: null, runs: 1, lastError: null },
        { job: 'job', owner: '', runs: 1, lastError: null },
      ],
    });
  });

  it('orders by instant, breaks ties by line, and retains the latest nonblank error after recovery', () => {
    writeEvents([
      { ...event, at: '2026-10-29T00:30:00+02:00', status: 'retry', error: ' older retry ' },
      { ...event, at: '2026-10-28T22:00:00Z', status: 'fail', error: 'first failure' },
      { ...event, at: '2026-10-28T23:00:00Z', status: 'ok', error: ' diagnostic on success ' },
      { ...event, at: '2026-10-28T18:00:00-05:00', status: 'fail', error: ' \t\n' },
      { ...event, at: '2026-10-29T00:00:00+01:00', owner: null, error: null },
    ]);
    const digest = readNight(runsDir, night);
    expect(digest).toEqual({
      badLines: 0, counts: { ok: 2, retry: 1, fail: 2 },
      rows: [{
        job: 'job', owner: null, runs: 5, retries: 1, lastStatus: 'ok',
        lastError: ' diagnostic on success ', hasFailure: true,
        firstAt: '2026-10-28T22:00:00Z', lastAt: '2026-10-29T00:00:00+01:00',
      }],
    });
    expect(digest!.rows.reduce((sum, row) => sum + row.runs, 0)).toBe(
      digest!.counts.ok + digest!.counts.retry + digest!.counts.fail,
    );
    expect(digest!.rows.reduce((sum, row) => sum + row.retries, 0)).toBe(digest!.counts.retry);
  });

  it('uses later lines for error ties and the first line for the earliest timestamp tie', () => {
    writeEvents([
      { ...event, at: '2026-10-28T23:00:00+01:00', error: 'first' },
      { ...event, at: '2026-10-28T22:00:00Z', error: ' second ' },
      { ...event, at: '2026-10-28T17:00:00-05:00' },
    ]);
    expect(readNight(runsDir, night)?.rows[0]).toMatchObject({
      firstAt: '2026-10-28T23:00:00+01:00', lastAt: '2026-10-28T17:00:00-05:00',
      lastError: ' second ',
    });
  });

  it('sorts exact job names by plain JS string comparison, including prototype-like names', () => {
    writeEvents(['ä', 'a', 'Z', 'A', '__proto__', 'constructor', ' a'].map(job => ({ ...event, job })));
    expect(readNight(runsDir, night)?.rows.map(row => row.job)).toEqual([
      ' a', 'A', 'Z', '__proto__', 'a', 'constructor', 'ä',
    ]);
  });

  it.each([
    '../2026-10-28', '/2026-10-28', '2026-10-28/../../secret', '2026-10-28.jsonl',
    '2026-10-28\n', ' 2026-10-28', '2026-1-01', '2026-00-01', '2026-13-01',
    '2026-10-00', '2026-04-31', '2026-02-29', '1900-02-29', '',
  ])('rejects invalid night %j without accessing the filesystem', invalidNight => {
    expect(readNight(runsDir, invalidNight)).toBeNull();
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it.each(['2000-02-29', '2024-02-29', '2026-12-31'])('accepts real calendar date %s', validNight => {
    fs.writeFileSync(join(runsDir, `${validNight}.jsonl`), '');
    expect(readNight(runsDir, validNight)).toEqual(empty);
  });

  it.each(['EACCES', 'EISDIR', 'ENOTDIR', 'EIO'])('propagates %s errors unchanged', code => {
    const failure = Object.assign(new Error('read failed'), { code });
    vi.mocked(fs.readFileSync).mockImplementationOnce(() => { throw failure; });
    expect(() => readNight(runsDir, night)).toThrow(failure);
  });
});
