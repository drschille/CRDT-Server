import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeFileAtomic } from '../src/persist.js';

describe('writeFileAtomic', () => {
  it('handles concurrent writes without leaving temp files', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'persist-'));
    try {
      const target = path.join(dir, 'registry.bin');
      const payloads = Array.from({ length: 6 }, (_, index) => Buffer.from(`payload-${index}`));

      await Promise.all(payloads.map((payload) => writeFileAtomic(target, payload)));

      const final = await readFile(target, 'utf8');
      expect(payloads.map((payload) => payload.toString('utf8'))).toContain(final);

      const files = await readdir(dir);
      expect(files.sort()).toEqual(['registry.bin']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
