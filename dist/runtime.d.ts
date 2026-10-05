import type { Prepared } from './prepare.js';
export interface RuntimeOptions {
    /** Milliseconds per render; default 3000. */
    timeout?: number;
    /** Milliseconds per engine start; default 10000. */
    startupTimeout?: number;
    /** The SVG terminal's canvas, which sets the output `viewBox`; default 1000×500. */
    size?: {
        width: number;
        height: number;
    };
    limits?: {
        /** Whole fence body, in string length; default 64000. */
        sourceChars?: number;
        /** Success output, in UTF-8 bytes; default 4 MiB. */
        outputBytes?: number;
    };
}
/** The render input is what `prepare` returns for the fence. */
export type RenderInput = Prepared;
export type RenderResult = {
    status: 'success';
    output: string;
    notes: string[];
} | {
    status: 'failure';
    message: string;
    line?: number;
    column?: number;
} | {
    status: 'timeout';
    budget: number;
} | {
    status: 'unavailable';
    reason: string;
};
export interface Runtime {
    render(input: RenderInput): RenderResult;
    dispose(): Promise<void>;
}
export declare function createRuntime(options?: RuntimeOptions): Promise<Runtime>;
