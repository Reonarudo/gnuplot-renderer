# gnuplot-renderer

Render [gnuplot](http://www.gnuplot.info) plots to safe, inline-ready SVG in Node, at build
time. One of five renderer libraries that share the
[render contract](http://192.168.188.68:3001/projects/markdown-renderers/wiki/Render_contract).

```sh
npm install https://github.com/Reonarudo/gnuplot-renderer/releases/download/v1.0.0/reonarudo-gnuplot-renderer-1.0.0.tgz
```

On npm 12 or later, the installing project also needs `allow-remote=root` in its `.npmrc`.
Nothing runs on install: `dist/` and the engine are committed.

## Use

```js
import { createRuntime, nodeFileReader, prepare } from '@reonarudo/gnuplot-renderer';

const runtime = await createRuntime();
// One reader per Markdown file; data files are found relative to it, inside the root.
const reader = nodeFileReader({ root: '/site/content', document: '/site/content/posts/post.md' });
const prepared = await prepare('plot "data/results.csv" using 1:2 with lines', { reader });
const result = runtime.render(prepared);
await runtime.dispose();
```

Rendering takes two steps:

1. **`prepare(source, { reader?, limits? })`** finds the data files the fence plots (literal
   `plot`/`splot` operands, never labels, comments or datablocks) and reads them through the
   reader. It resolves to the render input, which carries any problem it found as a failure for
   `render` to report. It rejects only for programmer errors, such as invalid limits. A fence
   that names no data files needs no reader.
2. **`render(prepared)`** is synchronous and returns one of:

| `status` | Fields | When |
| --- | --- | --- |
| `success` | `output`, `notes` | `output` is one `<svg class="gnuplot" viewBox="0 0 1000 500">` (the `viewBox` follows `size`) with no size, ready to inline; `notes` holds `print` output and warnings as plain text |
| `failure` | `message`, `line?`, `column?` | a gnuplot error (plain text, 1-based fence-relative position), a data-file problem found by `prepare`, an output-policy breach, a fence that draws nothing, or an exceeded limit |
| `timeout` | `budget` | the render ran past `timeout` milliseconds |
| `unavailable` | `reason` | the engine could not start |

`render` throws only for programmer errors: input that `prepare` did not produce, or a call
after `dispose()`. `createRuntime` rejects only for invalid options.

The prepared input's `identity` is a sha256 over the fence body and each data file's key and
content, with no absolute path, so it is the same on every machine. A consumer can use it as a
cache key.

### Runtime options

| Option | Default | |
| --- | --- | --- |
| `timeout` | `3000` | milliseconds per render |
| `startupTimeout` | `10000` | milliseconds per engine start, never charged to a render |
| `size` | `{ width: 1000, height: 500 }` | the SVG terminal's canvas and so the output `viewBox`; integers from 1 to 10000. gnuplot-specific: a smaller canvas draws text larger relative to the plot |
| `limits.sourceChars` | `64000` | fence body, in string length |
| `limits.outputBytes` | `4194304` | sanitized SVG, in UTF-8 bytes |

### Preparation limits

| Option | Default | |
| --- | --- | --- |
| `limits.files` | `16` | distinct data files a fence plots |
| `limits.fileBytes` | `1048576` | one data file; passed to the reader as `maxBytes` |
| `limits.totalBytes` | `4194304` | all data files of a fence together |

Each must be a finite positive number. Limits can be raised or lowered, never disabled.

### Data files

A data operand must be a literal relative path ending in `.csv`, `.dat` or `.txt`. Its **key** is
that path normalised (`./data/a.csv` → `data/a.csv`), relative to the Markdown file's folder. A
reader is any object with `read(key, { maxBytes }) → Promise<{ bytes } | { error }>`, where
`error` is a plain author-facing reason. `nodeFileReader({ root, document })` reads only regular
files inside `root`, reached without symbolic links (checked before and after `realpath`), no
larger than `maxBytes` and unchanged while read. Its errors never contain a path.

Each file is mounted in the engine as `data-N.dat`. Where that name shows up in a legend, a
message or a note, it is put back as the operand the author wrote.

### What the consumer does

The consumer does everything presentational:

- wraps the SVG: figure, caption, alt text, the author's class and alignment;
- escapes `message`, `notes` and `reason` when writing them into HTML;
- creates one runtime per build or preview, and disposes of it;
- creates one file reader per Markdown file;
- caches, if it wants to.

Plots are drawn on a white background; any dark-mode treatment is the consumer's.

## The output policy

The library owns the terminal (`svg size 1000,500 enhanced` unless `size` says otherwise, white background) and the output
file. A fence that sets or unsets `terminal` or `output`, or that `load`s or `call`s another
script, is a failure. Quoted text and comments do not count. The policy keeps rendering correct.
It is **not** the safety boundary. That boundary is the wasm build, described below.

## How the safety guarantees are met

Fence source and data files are treated as untrusted.

- **Bounded time.** gnuplot runs in a worker thread that `render` blocks on with
  `Atomics.wait`. A render past its budget terminates the worker. The next render starts a
  fresh one and waits for it under `startupTimeout` before its own budget begins.
- **Bounded memory.** The wasm heap is fixed at 64 MiB and is reset to its ready state after
  every render. The worker's JavaScript heap is capped at 128 MB. The plot file is capped as it
  is written, because the in-memory filesystem lives outside that heap. Data files are bounded
  by the preparation limits.
- **Bounded input and output.** `limits.sourceChars` is checked before the engine sees the
  source. `limits.outputBytes` is checked on the sanitized SVG.
- **No reach outside.** The engine is gnuplot compiled to wasm with no shell bridge and no host
  filesystem. Its in-memory filesystem opens only the plot file, plus the script and this
  render's data files for reading. So `system`, `!`, `plot "<cmd"`, absolute paths and
  `set print` to a data file all fail inside the engine.
- **Safe to inline.** Every SVG is parsed as XML and rebuilt from an allowlist. It keeps
  passive geometry, text, gnuplot's point markers, gradients and its text-box filters.
  `href` is kept only as `#id`, and `url()` only as `url(#id)`. No value may carry
  `javascript:`, `data:` or a network URL. Comments, the XML prologue and anything that is not
  well-formed SVG are refused.
- **Isolated.** Every `id`, `#id` reference and `url(#id)` is namespaced with
  `gnuplot-<8 hex>-`, taken from the prepared input's identity. Two plots on one page cannot
  address each other, and gnuplot emits no `<style>`.
- **Plain text out.** gnuplot's echo of the offending line is dropped from `message`. What
  remains is the error text, with its line and, where it can be pinned exactly, its column.
  `print` output and warnings become `notes`. A data operand is quoted as the author wrote it.

Output is deterministic: the same prepared input yields byte-identical SVG in any runtime.

## The engine

`vendor/gnuplot/` holds the unmodified official gnuplot 6.0.2 release compiled to wasm with
Emscripten 6.0.9, as an ES module adapter (`gnuplot.mjs`) and its `gnuplot.wasm`. To rebuild
it, on a machine with emcc 6.0.9:

```sh
scripts/build-wasm.sh
```

The script downloads the release, checks its sha256, configures without optional native
dependencies, links a browser/worker-only adapter with fixed memory, and rewrites
`provenance.json` and `SHA256SUMS`. To move to another release, change the version and archive
hash at the top of the script and the expectations in `test/vendor.test.ts`. CI never runs emcc;
it only verifies the committed files against `SHA256SUMS`.

## Development

```sh
npm ci
npm run lint
npm run compile        # tsc → dist/, which is committed; CI fails if it is stale
npm test               # tests import dist/, so compile first
UPDATE_GOLDEN=1 npm test  # re-record test/golden/ after a deliberate output change
npm run test:packed    # npm pack, install into a temp project, render one plot with a data file
```

Requires Node 22 or later (`.nvmrc` pins the version used in development).

## Releasing

Versions, golden SVG tests and the release procedure follow
[Releasing](http://192.168.188.68:3001/projects/markdown-renderers/wiki/Releasing).
What each version changed is in [CHANGELOG.md](CHANGELOG.md).
