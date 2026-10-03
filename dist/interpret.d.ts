import type { RenderResult } from './runtime.js';
import { type Request } from './protocol.js';
/** What one run of gnuplot left behind. */
export interface Run {
    exit: number;
    /** Everything gnuplot printed: `print` output, warnings and errors. */
    diagnostics: string;
    /** The plot file, if one was written. */
    svg?: string;
    /** Whether gnuplot tried to write more than the plot file may hold. */
    overflow: boolean;
}
/**
 * Turn one gnuplot run into a render result. Lines are counted in the fence body, so the
 * preamble is subtracted; a line outside the body, or a column that cannot be pinned exactly,
 * is left out rather than guessed.
 */
export declare function interpret(run: Run, request: Request): RenderResult;
