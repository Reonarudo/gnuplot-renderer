import type { RenderResult } from './runtime.js';
/** The host and its worker share one buffer: an Int32 header, then the reply as UTF-8 JSON. */
/** What the worker is asked to do for one fence. */
export interface Request {
    source: string;
    script: string;
    files: {
        name: string;
        label: string;
        bytes: Uint8Array;
    }[];
    prefix: string;
    outputBytes: number;
}
/** What the worker answers: a render result, and whether its engine must not be used again. */
export type Reply = RenderResult & {
    discard?: true;
};
/** Int32 slots at the head of the shared buffer. */
export declare const READY = 0;
export declare const LENGTH = 1;
export declare const ENGINE = 2;
/** Values of the ENGINE slot. */
export declare const STARTING = 0;
export declare const STARTED = 1;
export declare const FAILED = 2;
export declare const HEADER = 12;
/** Lines the library writes before the fence body: `set terminal` and `set output`. */
export declare const PREAMBLE_LINES = 2;
