import { posix } from 'node:path';
/** A datablock (`$name << EOD … EOD`) opening at a line start; its body is data, not commands. */
const datablock = /\s*\$\w+\s*<<\s*(\w+)[^\n]*\n/y;
/** A problem with how the fence names a data file, at an offset in the source. */
export class SourceError extends Error {
    offset;
    constructor(message, offset) {
        super(message);
        this.offset = offset;
    }
}
/** Tokenize only enough syntax to identify literal plot operands, never labels or comments. */
export function dataReferences(source) {
    const tokens = [];
    let i = 0;
    let lineStart = true;
    while (i < source.length) {
        if (lineStart) {
            datablock.lastIndex = i;
            const block = datablock.exec(source);
            if (block) {
                i += block[0].length;
                while (i < source.length) {
                    const end = source.indexOf('\n', i);
                    const stop = end < 0 ? source.length : end;
                    const line = source.slice(i, stop).trim();
                    i = end < 0 ? stop : end + 1;
                    if (line === block[1])
                        break;
                }
                continue;
            }
        }
        const c = source[i];
        if (c === '\\' && (source[i + 1] === '\n' || (source[i + 1] === '\r' && source[i + 2] === '\n'))) {
            i += source[i + 1] === '\r' ? 3 : 2;
            continue;
        }
        if (c === '#') {
            while (i < source.length && source[i] !== '\n')
                i++;
            continue;
        }
        if (/\s/.test(c) && c !== '\n') {
            i++;
            continue;
        }
        const start = i;
        if (c === '"' || c === "'") {
            i++;
            let value = '';
            while (i < source.length && source[i] !== c) {
                if (source[i] === '\\') {
                    const next = source[++i];
                    if (next === undefined)
                        break;
                    // Backslash escapes are intentionally limited for portable filenames.
                    value += next === c || next === '\\' ? next : '\\' + next;
                    i++;
                }
                else
                    value += source[i++];
            }
            if (source[i] !== c)
                throw new SourceError('unterminated quoted string', start);
            i++;
            tokens.push({ value, start, end: i, quoted: true });
        }
        else if (/[\w$]/.test(c)) {
            while (i < source.length && /[\w$]/.test(source[i]))
                i++;
            tokens.push({ value: source.slice(start, i), start, end: i, quoted: false });
        }
        else {
            i++;
            tokens.push({ value: c, start, end: i, quoted: false });
        }
        lineStart = c === '\n';
    }
    const references = [];
    let plotting = false, operand = false, depth = 0, statement = true, rangeDepth = 0;
    for (let n = 0; n < tokens.length; n++) {
        const t = tokens[n];
        if (!t.quoted && (t.value === '\n' || t.value === ';')) {
            plotting = false;
            operand = false;
            statement = true;
            depth = 0;
            rangeDepth = 0;
            continue;
        }
        if (statement) {
            plotting = !t.quoted && ['plot', 'splot'].includes(t.value.toLowerCase());
            operand = plotting;
            statement = false;
            if (plotting)
                continue;
        }
        if (!plotting)
            continue;
        if (operand && !t.quoted && t.value === '[') {
            rangeDepth++;
            continue;
        }
        if (rangeDepth) {
            if (!t.quoted && t.value === ']')
                rangeDepth--;
            continue;
        }
        if (operand) {
            operand = false;
            if (t.quoted && t.value) {
                const next = tokens[n + 1];
                if (next && !next.quoted && ['.', '+', '?', '['].includes(next.value)) {
                    throw new SourceError('computed data filenames are not supported; use a literal relative filename', t.start);
                }
                references.push({ path: t.value, start: t.start, end: t.end });
            }
        }
        if (!t.quoted && ['(', '[', '{'].includes(t.value))
            depth++;
        if (!t.quoted && [')', ']', '}'].includes(t.value))
            depth--;
        if (!t.quoted && t.value === ',' && depth === 0)
            operand = true;
    }
    return references;
}
/**
 * The key for an operand: relative, `/`-separated, normalised, one of the allowed extensions.
 * Throws with a plain author-facing message otherwise.
 */
export function dataKey(path) {
    if (!path || path.startsWith('/') || path.startsWith('~') || path.startsWith('<') || /[\\:\x00-\x1f]/.test(path)) {
        throw new Error('data files must be relative paths inside the content root');
    }
    const normalized = posix.normalize(path);
    if (!/\.(csv|dat|txt)$/i.test(normalized))
        throw new Error('only .csv, .dat and .txt data files are supported');
    return normalized;
}
/** Replace filename operands, not the author's labels or gnuplot datafile options. */
export function mountSource(source, references, names) {
    let result = source;
    for (const ref of [...references].reverse())
        result = result.slice(0, ref.start) + `"${names.get(ref.path)}"` + result.slice(ref.end);
    return result;
}
