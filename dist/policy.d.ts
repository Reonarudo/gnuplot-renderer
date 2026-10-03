/**
 * The output policy: the library owns the terminal and output file, and a fence may not pull in
 * other scripts. Correctness, not safety (ADR 0004) — the wasm build has no shell bridge and an
 * in-memory filesystem that opens only the script, the plot and the prepared data files.
 * Quoted labels and comments are ignored. Returns why the script breaks the policy, if it does.
 */
export declare function outputPolicy(script: string): string | undefined;
