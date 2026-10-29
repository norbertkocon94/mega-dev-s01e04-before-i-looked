import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repo = fileURLToPath(new URL('..', import.meta.url));
const script = join(repo, 'scripts/export-preview.ts');
const tsx = join(repo, 'node_modules/tsx/dist/cli.mjs');

describe('preview export command', () => {
  let temporary: string;

  beforeEach(() => {
    temporary = mkdtempSync(join(tmpdir(), 'rig-export-test-'));
  });

  afterEach(() => {
    rmSync(temporary, { recursive: true, force: true });
  });

  function run(output: string, marker?: string) {
    const env = { ...process.env };
    delete env.LANE_MARKER;
    if (marker !== undefined) env.LANE_MARKER = marker;
    return spawnSync(process.execPath, [tsx, '--tsconfig', join(repo, 'tsconfig.json'), script, output], {
      cwd: temporary, env, encoding: 'utf8', timeout: 15_000,
    });
  }

  it('exports the HTTP page silently and overwrites the same file for cleanup', () => {
    const output = join(temporary, 'nested', 'index.html');
    const marker = 'export-test<&>';
    const marked = run(output, marker);
    expect(marked.status).toBe(0);
    expect(marked.stdout).toBe('');
    expect(marked.stderr).toBe('');
    const html = readFileSync(output, 'utf8');
    expect(html.includes('<span class="marker">export-test&lt;&amp;&gt;</span>')).toBe(true);
    expect(html.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0].match(/<tr\b/g)?.length).toBe(5);
    expect(html.includes('malformed lines: 1')).toBe(true);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(/<script\b|<link\b|\bsrc\s*=|\bon\w+\s*=|url\s*\(|@import/i.test(html)).toBe(false);

    // Neither an ignored repository .env nor one in the caller's cwd should be loaded.
    writeFileSync(join(temporary, '.env'), 'LANE_MARKER=must-not-load\n');
    const clean = run(output);
    expect(clean.status).toBe(0);
    expect(clean.stdout).toBe('');
    expect(clean.stderr).toBe('');
    const cleaned = readFileSync(output, 'utf8');
    expect(cleaned.includes('<span class="marker">no marker set</span>')).toBe(true);
    expect(cleaned.includes('must-not-load')).toBe(false);
    expect(cleaned.includes('export-test')).toBe(false);
  });

  it('rejects a new destination inside the repository before writing', () => {
    const output = join(repo, 'rejected-preview', 'index.html');
    const result = run(output);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(existsSync(join(repo, 'rejected-preview'))).toBe(false);
  });

  it('rejects an outside directory symlink pointing into the repository', () => {
    const alias = join(temporary, 'repo-alias');
    symlinkSync(repo, alias, 'dir');
    const result = run(join(alias, 'rejected-preview', 'index.html'));
    expect(result.status).toBe(1);
    expect(existsSync(join(repo, 'rejected-preview'))).toBe(false);
  });

  it('rejects an outside file symlink pointing into the repository', () => {
    const output = join(temporary, 'index.html');
    symlinkSync(join(repo, 'package.json'), output);
    expect(run(output).status).toBe(1);
  });
});
