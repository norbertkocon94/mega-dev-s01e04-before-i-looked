export type DigestStatus = 'ok' | 'retry' | 'fail';

/** One row per exact job name, aggregated from valid events only. */
export type DigestRow = {
  job: string;
  /** Owner on the latest event, including null; never carry an older owner forward. */
  owner: string | null;
  /** Total events for this job, including retries and failures. */
  runs: number;
  /** Number of events whose status is retry. */
  retries: number;
  lastStatus: DigestStatus;
  /**
   * Most recent non-blank error string, regardless of event status, or null.
   * Later events without an error do not clear it, including successful events.
   * Preserve the original error text; whitespace-only errors count as absent.
   */
  lastError: string | null;
  /** True if any event failed, even if the job later recovered. */
  hasFailure: boolean;
  /** Original timestamp strings of the earliest/latest events, with offsets intact. */
  firstAt: string;
  lastAt: string;
};

/** Event counts across the entire night, not counts of jobs or their last statuses. */
export type DigestCounts = {
  ok: number;
  retry: number;
  fail: number;
};

/** An existing file, including an empty file or one with no valid events. */
export type NightDigest = {
  /** One row per job, sorted ascending by exact job name using JS string comparison. */
  rows: DigestRow[];
  /** Invalid non-blank lines, counted once each and excluded from all aggregates. */
  badLines: number;
  /** Shared by the board, page and JSON consumers; no second log parser is needed. */
  counts: DigestCounts;
};

/**
 * Canonical implementation: a named value export `readNight` in
 * `src/digest/reader.ts`, annotated with this type (or an equivalent signature).
 * Consumers import that value from './digest/reader.js', not from this type module.
 * This contract deliberately provides no stub implementation.
 *
 * Read runsDir/<night>.jsonl synchronously. `night` must be a real calendar date
 * spelled YYYY-MM-DD; reject other input as null without accessing the filesystem.
 * For I/O errors, only a missing file/directory (ENOENT) returns null; propagate others.
 * Routes map null to 404. An existing empty/whitespace-only file returns
 * { rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } } and renders
 * "nothing ran" with HTTP 200. A file with only invalid lines also has no rows
 * and zero counts, but retains its badLines count and is still an existing night.
 *
 * Parse each non-blank JSONL line independently. Blank lines (including the final
 * newline) are ignored. Invalid JSON or an invalid schema increments badLines;
 * neither aborts the read. A valid event is a non-null, non-array object with:
 * - at: a parseable ISO 8601 date-time with explicit Z or +/-HH:MM timezone;
 * - job: a non-blank string (preserve it exactly for grouping and display);
 * - status: exactly 'ok', 'retry' or 'fail';
 * - owner: a required string or null;
 * - error: an optional string or null.
 * Unknown fields are ignored; do not coerce invalid fields or default a missing
 * owner to null. Events belong to the requested file even across midnight.
 *
 * Order events by their parsed instant, not timestamp text or file order.
 * Equal instants use original line order, with the later line considered later.
 * This ordering defines owner, lastStatus, lastError, firstAt and lastAt.
 * Preserve timestamp strings verbatim for display; never convert them to UTC.
 * Sort the resulting rows by job with locale-independent JS string comparison.
 * Every valid event contributes exactly once to runs and its status count:
 * sum(rows.runs) = counts.ok + counts.retry + counts.fail, and
 * sum(rows.retries) = counts.retry. All counters are non-negative integers.
 * HTML and JSON consumers use these same rows and ordering; the board uses counts.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
