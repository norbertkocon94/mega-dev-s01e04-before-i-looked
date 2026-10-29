import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, DigestStatus, NightDigest, ReadNight } from './types.js';

type RunEvent = {
  at: string;
  job: string;
  status: DigestStatus;
  owner: string | null;
  error?: string | null;
};

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const instant = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRunEvent(value: unknown): value is RunEvent {
  if (!isRecord(value)) return false;
  return (
    typeof value.at === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.at) &&
    isCalendarDate(value.at.slice(0, 10)) &&
    Number.isFinite(Date.parse(value.at)) &&
    typeof value.job === 'string' && value.job.trim().length > 0 &&
    (value.status === 'ok' || value.status === 'retry' || value.status === 'fail') &&
    (typeof value.owner === 'string' || value.owner === null) &&
    (!('error' in value) || typeof value.error === 'string' || value.error === null)
  );
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!isCalendarDate(night)) return null;

  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error: unknown) {
    if (isRecord(error) && error.code === 'ENOENT') return null;
    throw error;
  }

  const digest: NightDigest = { rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
  const events: { event: RunEvent; instant: number; line: number }[] = [];
  for (const [line, text] of contents.split('\n').entries()) {
    if (!text.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      digest.badLines++;
      continue;
    }
    if (!isRunEvent(value)) {
      digest.badLines++;
      continue;
    }
    events.push({ event: value, instant: Date.parse(value.at), line });
  }
  events.sort((a, b) => a.instant - b.instant || a.line - b.line);

  const jobs = new Map<string, DigestRow>();
  for (const { event } of events) {
    const row = jobs.get(event.job) ?? {
      job: event.job,
      owner: event.owner,
      runs: 0,
      retries: 0,
      lastStatus: event.status,
      lastError: null,
      hasFailure: false,
      firstAt: event.at,
      lastAt: event.at,
    };
    row.runs++;
    if (event.status === 'retry') row.retries++;
    if (event.status === 'fail') row.hasFailure = true;
    if (event.error?.trim()) row.lastError = event.error;
    row.owner = event.owner;
    row.lastStatus = event.status;
    row.lastAt = event.at;
    digest.counts[event.status]++;
    jobs.set(event.job, row);
  }
  digest.rows = [...jobs.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return digest;
};
