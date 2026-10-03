/** Thrown when the sanitized SVG would exceed the output limit. */
export declare class OutputTooLarge extends Error {
}
export interface SanitizeOptions {
    /** Prepended to every id and every reference to one: `gnuplot-<8 hex>-`. */
    prefix: string;
    /** Mounted data-file names (`data-0.dat`) and the operand the author wrote for each. */
    labels?: ReadonlyMap<string, string>;
    /** UTF-8 bytes the result may take. */
    outputBytes: number;
}
/**
 * Parse gnuplot's SVG as XML, keep only the allowlisted elements and attributes, namespace every
 * id and local reference, and restore the author's data-file names in text. The root keeps its
 * `viewBox` and the class `gnuplot`, nothing that sizes it. Throws, with a fixed plain message,
 * on anything that is not a well-formed SVG document, and `OutputTooLarge` past the limit.
 */
export declare function sanitizeSvg(source: string, { prefix, labels, outputBytes }: SanitizeOptions): string;
