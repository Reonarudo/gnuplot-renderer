import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { FileReader } from './prepare.js';

// This file is identical in gnuplot-renderer and spice-renderer, with the same tests (ADR 0002).

export interface NodeFileReaderOptions {
  /** Absolute path of the folder no referenced file may escape. */
  root: string;
  /** Absolute path of the Markdown file whose fences are read; keys are relative to its folder. */
  document: string;
}

/** An author-facing reason a file cannot be read. Never carries a path. */
class Refusal extends Error {}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}

/** The reason for a filesystem error, in words that hold no path. */
function reason(error: unknown): string {
  if (error instanceof Refusal) return error.message;
  switch ((error as { code?: string }).code) {
    case 'ENOENT': case 'ENOTDIR': return 'file not found';
    case 'EACCES': case 'EPERM': return 'permission denied';
    case 'ELOOP': return 'symbolic links are not followed';
    case 'EISDIR': return 'not a regular file';
    default: return 'the file could not be read';
  }
}

/**
 * Check that `target` lies inside `root` both as written and once resolved, with no symbolic link
 * on the way from the root to it.
 */
async function contain(root: string, target: string): Promise<void> {
  if (!inside(root, target)) throw new Refusal('the file is outside the content root');
  let cursor = root;
  for (const part of relative(root, target).split(sep)) {
    cursor = resolve(cursor, part);
    if ((await lstat(cursor)).isSymbolicLink()) throw new Refusal('symbolic links are not followed');
  }
  if (!inside(await realpath(root), await realpath(target))) throw new Refusal('the file is outside the content root');
}

/**
 * A file reader over the local filesystem for one Markdown file. It reads only regular files
 * inside `root`, reached without symbolic links, no larger than the caller's `maxBytes`, and
 * unchanged while they were read. It never rejects for a file problem, and never reveals a path.
 */
export function nodeFileReader(options: NodeFileReaderOptions): FileReader {
  const { root, document } = (options ?? {}) as Partial<NodeFileReaderOptions>;
  if (typeof root !== 'string' || !isAbsolute(root)) throw new TypeError('root must be an absolute path');
  if (typeof document !== 'string' || !isAbsolute(document)) throw new TypeError('document must be an absolute path');
  const base = resolve(root);
  const folder = dirname(resolve(document));

  return {
    async read(key, { maxBytes }) {
      if (typeof key !== 'string' || key.includes('\0')) return { error: 'the file name is not valid' };
      const target = resolve(folder, key);
      try {
        await contain(base, target);
        const file = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
          const before = await file.stat();
          if (!before.isFile()) throw new Refusal('not a regular file');
          if (before.size > maxBytes) throw new Refusal(`the file exceeds the ${maxBytes}-byte limit`);
          // Read one byte past the limit, so a file that grew since the stat is caught.
          const buffer = new Uint8Array(Math.min(before.size, maxBytes) + 1);
          let length = 0;
          for (;;) {
            const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
            if (bytesRead === 0) break;
            length += bytesRead;
            if (length === buffer.length) break;
          }
          const after = await file.stat();
          if (length > maxBytes) throw new Refusal(`the file exceeds the ${maxBytes}-byte limit`);
          if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || length !== before.size) {
            throw new Refusal('the file changed while it was read');
          }
          // The path may have been swapped for a link while the file was read.
          await contain(base, target);
          return { bytes: buffer.slice(0, length) };
        } finally {
          await file.close();
        }
      } catch (error) {
        return { error: reason(error) };
      }
    }
  };
}
