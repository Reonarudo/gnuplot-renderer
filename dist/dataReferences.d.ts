/** One literal data-file operand of a `plot` or `splot`, as written, with its offsets in the source. */
export interface DataReference {
    readonly path: string;
    readonly start: number;
    readonly end: number;
}
/** A problem with how the fence names a data file, at an offset in the source. */
export declare class SourceError extends Error {
    readonly offset: number;
    constructor(message: string, offset: number);
}
/** Tokenize only enough syntax to identify literal plot operands, never labels or comments. */
export declare function dataReferences(source: string): DataReference[];
/**
 * The key for an operand: relative, `/`-separated, normalised, one of the allowed extensions.
 * Throws with a plain author-facing message otherwise.
 */
export declare function dataKey(path: string): string;
/** Replace filename operands, not the author's labels or gnuplot datafile options. */
export declare function mountSource(source: string, references: readonly DataReference[], names: ReadonlyMap<string, string>): string;
