import { serve } from '@hono/node-server';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const repo = await realpath(fileURLToPath(new URL('..', import.meta.url)));

// Resolve existing symlinks even when the output's final directories do not exist yet.
async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    return join(await canonicalPath(dirname(path)), basename(path));
  }
}

function requireOutsideRepo(path: string) {
  const fromRepo = relative(repo, path);
  if (fromRepo !== '..' && !fromRepo.startsWith(`..${sep}`) && !isAbsolute(fromRepo)) {
    throw new Error('Preview output must be outside the repository.');
  }
}

async function main() {
  const [argument, ...extra] = process.argv.slice(2);
  if (!argument || extra.length) throw new Error('Usage: pnpm export:preview /outside/repo/index.html');
  const output = resolve(argument);
  requireOutsideRepo(output);
  requireOutsideRepo(await canonicalPath(output));
  requireOutsideRepo(await canonicalPath(dirname(output)));

  const config = loadConfig(join(repo, 'rig.json'));
  config.runsDir = resolve(repo, config.runsDir);
  // Use the real HTTP adapter without starting the heartbeat or loading .env.
  const server = serve({ fetch: createApp(config).fetch, hostname: '127.0.0.1', port: 0 });
  try {
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No loopback port assigned.');
    const response = await fetch(`http://127.0.0.1:${address.port}/digest/2026-10-28`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
      throw new Error('Digest export did not return an HTML page.');
    }
    const html = await response.text();
    await mkdir(dirname(output), { recursive: true });
    requireOutsideRepo(await realpath(dirname(output)));
    // Rename a fresh file so an existing output symlink/hard link is never followed.
    const staging = await mkdtemp(join(dirname(output), '.rig-preview-'));
    try {
      const temporary = join(staging, 'index.html');
      await writeFile(temporary, html, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, output);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  } finally {
    await new Promise<void>((resolveClose, reject) => {
      server.close(error => error ? reject(error) : resolveClose());
    });
  }
}

try {
  await main();
} catch {
  // Do not include response bodies, environment values or paths in logs.
  console.error('Preview export failed. Supply one writable HTML path outside the repository.');
  process.exitCode = 1;
}
