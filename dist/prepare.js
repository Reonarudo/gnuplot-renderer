import { createHash } from 'node:crypto';
import { dataKey, dataReferences, mountSource } from './dataReferences.js';
/** A limit: absent for its default, else a finite positive number. */
function limit(value, name, fallback) {
    if (value === undefined)
        return fallback;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new TypeError(`${name} must be a finite positive number`);
    }
    return value;
}
/** 1-based line and column of an offset in the source. */
function position(source, offset) {
    const before = source.slice(0, offset);
    const lineStart = before.lastIndexOf('\n') + 1;
    return { line: before.split('\n').length, column: offset - lineStart + 1 };
}
/**
 * Find the data files a gnuplot fence plots, read them through `reader`, and return the render
 * input. Resolves for anything the fence or its files can cause, carrying the failure for
 * `render` to report; rejects only for programmer errors such as invalid limits.
 */
export async function prepare(source, options = {}) {
    if (typeof source !== 'string')
        throw new TypeError('prepare() takes the fence body as a string');
    if (typeof options !== 'object' || options === null)
        throw new TypeError('options must be an object');
    if (options.limits !== undefined && (typeof options.limits !== 'object' || options.limits === null)) {
        throw new TypeError('limits must be an object');
    }
    const { reader } = options;
    if (reader !== undefined && typeof reader?.read !== 'function')
        throw new TypeError('reader must have a read() method');
    const maxFiles = limit(options.limits?.files, 'limits.files', 16);
    const maxTotal = limit(options.limits?.totalBytes, 'limits.totalBytes', 4 * 1024 * 1024);
    const maxFile = limit(options.limits?.fileBytes, 'limits.fileBytes', 1024 * 1024);
    const identity = createHash('sha256').update(JSON.stringify(source));
    const failed = (message, at) => {
        identity.update(JSON.stringify(['failure', message]));
        return {
            source, script: source, files: [], identity: identity.digest('hex'),
            failure: at === undefined ? { message } : { message, ...position(source, at) }
        };
    };
    let references;
    try {
        references = dataReferences(source);
    }
    catch (error) {
        return failed(error.message, error.offset);
    }
    if (references.length === 0)
        return { source, script: source, files: [], identity: identity.digest('hex') };
    // One mounted file per distinct operand as written, in order of first appearance.
    const operands = new Map();
    for (const reference of references)
        if (!operands.has(reference.path))
            operands.set(reference.path, reference);
    if (operands.size > maxFiles)
        return failed(`a plot can name at most ${maxFiles} data files`);
    const keys = new Map();
    for (const [operand, reference] of operands) {
        try {
            keys.set(operand, dataKey(operand));
        }
        catch (error) {
            return failed(`${error.message}: ${JSON.stringify(operand)}`, reference.start);
        }
    }
    if (!reader)
        return failed('this fence plots data files, but no file reader was given to read them');
    const files = [];
    const names = new Map();
    let total = 0;
    for (const [operand, reference] of operands) {
        const key = keys.get(operand);
        let read;
        try {
            read = await reader.read(key, { maxBytes: maxFile });
        }
        catch {
            read = { error: 'the file reader failed' };
        }
        const cannot = (reason) => {
            identity.update(JSON.stringify([key]));
            return failed(`cannot load data file ${JSON.stringify(operand)}: ${reason}`, reference.start);
        };
        if ('error' in read)
            return cannot(typeof read.error === 'string' ? read.error : 'unreadable');
        const { bytes } = read;
        if (!(bytes instanceof Uint8Array))
            return cannot('the file reader returned no bytes');
        if (bytes.length > maxFile)
            return cannot(`it exceeds the ${maxFile}-byte limit`);
        total += bytes.length;
        if (total > maxTotal)
            return cannot(`the fence's data files exceed the ${maxTotal}-byte limit together`);
        const name = `data-${files.length}.dat`;
        names.set(operand, name);
        files.push({ name, key, label: operand, bytes });
        identity.update(JSON.stringify([key, createHash('sha256').update(bytes).digest('hex')]));
    }
    return { source, script: mountSource(source, references, names), files, identity: identity.digest('hex') };
}
