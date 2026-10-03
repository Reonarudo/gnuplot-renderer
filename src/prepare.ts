import { createHash } from 'node:crypto';
import { dataKey, dataReferences, mountSource, SourceError, type DataReference } from './dataReferences.js';

/**
 * Reads referenced files for one Markdown file (ADR 0002). `key` is relative to that file's
 * folder, `/`-separated, never absolute. `error` is a plain author-facing reason, never a path.
 */
export interface FileReader {
  read(key: string, options: { maxBytes: number }): Promise<{ bytes: Uint8Array } | { error: string }>;
}

export interface PrepareOptions {
  /** Needed only when the fence names data files. */
  reader?: FileReader;
  limits?: {
    /** Distinct data files per fence; default 16. */
    files?: number;
    /** All data files of a fence together, in bytes; default 4 MiB. */
    totalBytes?: number;
    /** One data file, in bytes; default 1 MiB. */
    fileBytes?: number;
  };
}

/** One data file, mounted in the engine as `name` (`data-N.dat`) and shown to the author as `label`. */
export interface DataFile {
  readonly name: string;
  readonly key: string;
  /** The operand as the author wrote it. */
  readonly label: string;
  readonly bytes: Uint8Array;
}

/**
 * The render input for one fence: what `render` takes. Produced only by `prepare`; treat it as
 * opaque. `identity` is a sha256 over the fence body and each data file's key and content (or
 * the reason it could not be read), with no absolute path in it.
 */
export interface Prepared {
  readonly source: string;
  /** The fence body with each data operand replaced by its mounted name. */
  readonly script: string;
  readonly files: readonly DataFile[];
  readonly identity: string;
  /** Why the fence cannot be rendered, found during preparation; `render` reports it. */
  readonly failure?: { readonly message: string; readonly line?: number; readonly column?: number };
}

/** A limit: absent for its default, else a finite positive number. */
function limit(value: unknown, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a finite positive number`);
  }
  return value;
}

/** 1-based line and column of an offset in the source. */
function position(source: string, offset: number): { line: number; column: number } {
  const before = source.slice(0, offset);
  const lineStart = before.lastIndexOf('\n') + 1;
  return { line: before.split('\n').length, column: offset - lineStart + 1 };
}

/**
 * Find the data files a gnuplot fence plots, read them through `reader`, and return the render
 * input. Resolves for anything the fence or its files can cause, carrying the failure for
 * `render` to report; rejects only for programmer errors such as invalid limits.
 */
export async function prepare(source: string, options: PrepareOptions = {}): Promise<Prepared> {
  if (typeof source !== 'string') throw new TypeError('prepare() takes the fence body as a string');
  if (typeof options !== 'object' || options === null) throw new TypeError('options must be an object');
  if (options.limits !== undefined && (typeof options.limits !== 'object' || options.limits === null)) {
    throw new TypeError('limits must be an object');
  }
  const { reader } = options;
  if (reader !== undefined && typeof reader?.read !== 'function') throw new TypeError('reader must have a read() method');
  const maxFiles = limit(options.limits?.files, 'limits.files', 16);
  const maxTotal = limit(options.limits?.totalBytes, 'limits.totalBytes', 4 * 1024 * 1024);
  const maxFile = limit(options.limits?.fileBytes, 'limits.fileBytes', 1024 * 1024);

  const identity = createHash('sha256').update(JSON.stringify(source));
  const failed = (message: string, at?: number): Prepared => {
    identity.update(JSON.stringify(['failure', message]));
    return {
      source, script: source, files: [], identity: identity.digest('hex'),
      failure: at === undefined ? { message } : { message, ...position(source, at) }
    };
  };

  let references: DataReference[];
  try {
    references = dataReferences(source);
  } catch (error) {
    return failed((error as Error).message, (error as SourceError).offset);
  }
  if (references.length === 0) return { source, script: source, files: [], identity: identity.digest('hex') };

  // One mounted file per distinct operand as written, in order of first appearance.
  const operands = new Map<string, DataReference>();
  for (const reference of references) if (!operands.has(reference.path)) operands.set(reference.path, reference);
  if (operands.size > maxFiles) return failed(`a plot can name at most ${maxFiles} data files`);
  const keys = new Map<string, string>();
  for (const [operand, reference] of operands) {
    try {
      keys.set(operand, dataKey(operand));
    } catch (error) {
      return failed(`${(error as Error).message}: ${JSON.stringify(operand)}`, reference.start);
    }
  }
  if (!reader) return failed('this fence plots data files, but no file reader was given to read them');

  const files: DataFile[] = [];
  const names = new Map<string, string>();
  let total = 0;
  for (const [operand, reference] of operands) {
    const key = keys.get(operand)!;
    let read: { bytes: Uint8Array } | { error: string };
    try {
      read = await reader.read(key, { maxBytes: maxFile });
    } catch {
      read = { error: 'the file reader failed' };
    }
    const cannot = (reason: string): Prepared => {
      identity.update(JSON.stringify([key]));
      return failed(`cannot load data file ${JSON.stringify(operand)}: ${reason}`, reference.start);
    };
    if ('error' in read) return cannot(typeof read.error === 'string' ? read.error : 'unreadable');
    const { bytes } = read;
    if (!(bytes instanceof Uint8Array)) return cannot('the file reader returned no bytes');
    if (bytes.length > maxFile) return cannot(`it exceeds the ${maxFile}-byte limit`);
    total += bytes.length;
    if (total > maxTotal) return cannot(`the fence's data files exceed the ${maxTotal}-byte limit together`);
    const name = `data-${files.length}.dat`;
    names.set(operand, name);
    files.push({ name, key, label: operand, bytes });
    identity.update(JSON.stringify([key, createHash('sha256').update(bytes).digest('hex')]));
  }
  return { source, script: mountSource(source, references, names), files, identity: identity.digest('hex') };
}
