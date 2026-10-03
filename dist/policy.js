/**
 * The output policy: the library owns the terminal and output file, and a fence may not pull in
 * other scripts. Correctness, not safety (ADR 0004) — the wasm build has no shell bridge and an
 * in-memory filesystem that opens only the script, the plot and the prepared data files.
 * Quoted labels and comments are ignored. Returns why the script breaks the policy, if it does.
 */
export function outputPolicy(script) {
    const code = script.replace(/\\\r?\n/g, '').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[^\n]*/g, ' ');
    if (/\b(?:set|unset)\s+(?:term(?:i(?:n(?:a(?:l)?)?)?)?|out(?:p(?:u(?:t)?)?)?)\b/i.test(code)) {
        return 'gnuplot-renderer controls the terminal and output; remove set terminal and set output';
    }
    if (/(?:^|[;\n])\s*(?:load|call)\b/i.test(code))
        return 'loading other gnuplot scripts is not supported';
    return undefined;
}
