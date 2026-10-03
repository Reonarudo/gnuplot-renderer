# Third-party notices and engine provenance

The library's own TypeScript, tests and scripts are MIT licensed (see `LICENSE`). This does
not relicense the vendored engine or its dependencies.

## Gnuplot 6.0.2

Copyright 1986–1993, 1998, 2004 Thomas Williams, Colin Kelley, with additional contributors
identified in `licenses/GNUPLOT-SOURCE-NOTICES.txt`.

`vendor/gnuplot/` was compiled from the **unmodified official gnuplot 6.0.2 release**,
downloaded from
<https://sourceforge.net/projects/gnuplot/files/gnuplot/6.0.2/gnuplot-6.0.2.tar.gz/download>.
Source archive SHA-256: `f68a3b0bbb7bbbb437649674106d94522c00bf2f285cce0c19c3180b1ee7e738`.

The full gnuplot redistribution terms are in `licenses/GNUPLOT-COPYRIGHT`. Keep that file and
this document with any redistribution. Gnuplot has its own license, which is neither MIT nor
GPL. Component notices, including those for BSD-licensed numerical code, are in
`licenses/GNUPLOT-SOURCE-NOTICES.txt`.

No gnuplot source changes or patches were applied. The configuration and linker flags select a
browser/worker-only Emscripten adapter, disable dynamic execution and optional native
dependencies, and set fixed linear memory. The license's additional conditions for binaries
compiled from **modified source** therefore do not apply to this build. The library's
filesystem and rendering policy lives in its own TypeScript wrapper.

Build: `scripts/build-wasm.sh`, with Emscripten 6.0.9. `vendor/gnuplot/provenance.json` records
the release, archive hash and compiler. `vendor/gnuplot/SHA256SUMS` pins the artifacts, and the
test suite checks them.

Upstream: <http://www.gnuplot.info/> and gnuplot-info@lists.sourceforge.net.

## Emscripten and standard libraries

The generated JavaScript adapter and its linked runtime contain:

- Emscripten code, under the MIT and University of Illinois/NCSA licenses
  (`licenses/EMSCRIPTEN-LICENSE`);
- musl libc (`licenses/MUSL-COPYRIGHT`);
- LLVM runtime and libc++ components (`licenses/LLVM-LICENSE`).

## XML parser

`@xmldom/xmldom` is a runtime dependency, installed from the npm registry and not bundled. It
parses SVG for sanitizing. Its MIT license and attribution are in `licenses/XMLDOM-LICENSE`.

## Origin

This library began as a copy of the renderer in
[gnuplot-markdown-preview](https://github.com/Reonarudo/gnuplot-markdown-preview), MIT licensed.
That extension carries the licensing audit of the engine build and its evaluation of
`gnuplot-wasm`, which is not redistributed.
