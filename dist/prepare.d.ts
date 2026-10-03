/**
 * Reads referenced files for one Markdown file (ADR 0002). `key` is relative to that file's
 * folder, `/`-separated, never absolute. `error` is a plain author-facing reason, never a path.
 */
export interface FileReader {
    read(key: string, options: {
        maxBytes: number;
    }): Promise<{
        bytes: Uint8Array;
    } | {
        error: string;
    }>;
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
    readonly failure?: {
        readonly message: string;
        readonly line?: number;
        readonly column?: number;
    };
}
/**
 * Find the data files a gnuplot fence plots, read them through `reader`, and return the render
 * input. Resolves for anything the fence or its files can cause, carrying the failure for
 * `render` to report; rejects only for programmer errors such as invalid limits.
 */
export declare function prepare(source: string, options?: PrepareOptions): Promise<Prepared>;
