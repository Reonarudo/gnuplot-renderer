import type { RenderResult } from './runtime.js';
import { PREAMBLE_LINES, type Request } from './protocol.js';
import { OutputTooLarge, sanitizeSvg } from './sanitizer.js';

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

/** `"script.gp" line 4: unrecognized plot type` — gnuplot's located message. */
const located = /^"script\.gp" line (\d+): (.*)$/;
/** The caret gnuplot writes under the echoed input line. */
const caret = /^ *\^$/;

/**
 * Turn one gnuplot run into a render result. Lines are counted in the fence body, so the
 * preamble is subtracted; a line outside the body, or a column that cannot be pinned exactly,
 * is left out rather than guessed.
 */
export function interpret(run: Run, request: Request): RenderResult {
  const { source, script, files, prefix, outputBytes } = request;
  const labels = new Map(files.map((file) => [file.name, file.label]));
  const relabel = (text: string): string => text.replace(/data-\d+\.dat/g, (name) => labels.get(name) ?? name);
  const tooLarge: RenderResult = { status: 'failure', message: `gnuplot output exceeds the ${outputBytes}-byte limit` };
  const lines = run.diagnostics.split('\n').map((line) => line.trimEnd());
  const sourceLines = source.split('\n');
  const fenceLine = (scriptLine: number): number | undefined => {
    const line = scriptLine - PREAMBLE_LINES;
    return line >= 1 && line <= sourceLines.length ? line : undefined;
  };

  if (run.overflow) return tooLarge;

  if (run.exit !== 0) {
    let at = lines.length - 1;
    while (at >= 0 && !(located.test(lines[at]!) && !located.exec(lines[at]!)![2]!.startsWith('warning:'))) at--;
    if (at < 0) return { status: 'failure', message: 'gnuplot rejected this fence' };
    const [, number, text] = located.exec(lines[at]!)!;
    const message = relabel([text!, ...lines.slice(at + 1).filter((l) => l.trim() !== '')].join('\n'));
    const line = fenceLine(Number(number));
    if (line === undefined) return { status: 'failure', message };
    const column = locate(lines.slice(0, at), sourceLines[line - 1]!, script.split('\n')[line - 1]!);
    return column === undefined ? { status: 'failure', message, line } : { status: 'failure', message, line, column };
  }

  if (run.svg === undefined || !run.svg.includes('</svg>')) return { status: 'failure', message: 'the fence draws no plot' };
  let output: string;
  try {
    output = sanitizeSvg(run.svg, { prefix, labels, outputBytes });
  } catch (error) {
    if (error instanceof OutputTooLarge) return tooLarge;
    return { status: 'failure', message: (error as Error).message };
  }
  return { status: 'success', output, notes: notes(lines, fenceLine).map(relabel) };
}

/**
 * The column of a caret under the echoed line, 1-based in the fence body. gnuplot echoes the
 * line without its indentation; the column is given only when that line was not rewritten by
 * data-file mounting and the echo is exactly the rest of it.
 */
function locate(before: string[], sourceLine: string, scriptLine: string): number | undefined {
  const caretLine = before.at(-1);
  const echo = before.at(-2);
  if (caretLine === undefined || echo === undefined || !caret.test(caretLine)) return undefined;
  if (sourceLine !== scriptLine) return undefined;
  const indent = sourceLine.length - sourceLine.trimStart().length;
  if (sourceLine.slice(indent).trimEnd() !== echo) return undefined;
  return indent + caretLine.indexOf('^') + 1;
}

/** Warnings, located in the fence body, and `print` output; excerpts and blank lines dropped. */
function notes(lines: string[], fenceLine: (scriptLine: number) => number | undefined): string[] {
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') continue;
    if (caret.test(lines[i + 1] ?? '')) { i++; continue; }
    const match = located.exec(line);
    if (!match) { kept.push(line); continue; }
    const text = match[2]!.replace(/^warning: /, '');
    const at = fenceLine(Number(match[1]));
    kept.push(at === undefined ? text : `line ${at}: ${text}`);
  }
  return kept;
}
