import type { FileReader } from './prepare.js';
export interface NodeFileReaderOptions {
    /** Absolute path of the folder no referenced file may escape. */
    root: string;
    /** Absolute path of the Markdown file whose fences are read; keys are relative to its folder. */
    document: string;
}
/**
 * A file reader over the local filesystem for one Markdown file. It reads only regular files
 * inside `root`, reached without symbolic links, no larger than the caller's `maxBytes`, and
 * unchanged while they were read. It never rejects for a file problem, and never reveals a path.
 */
export declare function nodeFileReader(options: NodeFileReaderOptions): FileReader;
