#!/usr/bin/env bash
# Rebuild vendor/gnuplot from the unmodified official gnuplot release with Emscripten 6.0.9, then
# rewrite provenance.json and SHA256SUMS. Runs locally only; CI checks the committed files.
set -euo pipefail
VERSION=6.0.2
ARCHIVE_SHA256=f68a3b0bbb7bbbb437649674106d94522c00bf2f285cce0c19c3180b1ee7e738
EMCC=6.0.9
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="$ROOT/vendor/gnuplot"
BUILD=$(mktemp -d)
trap 'rm -rf "$BUILD"' EXIT

emcc --version | head -1 | grep -F "$EMCC" >/dev/null || { echo "emcc $EMCC is required" >&2; exit 1; }
curl --fail --location "https://downloads.sourceforge.net/project/gnuplot/gnuplot/$VERSION/gnuplot-$VERSION.tar.gz" -o "$BUILD/source.tar.gz"
echo "$ARCHIVE_SHA256  $BUILD/source.tar.gz" | shasum -a 256 -c - >/dev/null
tar xzf "$BUILD/source.tar.gz" -C "$BUILD"
cd "$BUILD/gnuplot-$VERSION"
emconfigure ./configure --disable-largefile --disable-plugins --disable-history-file \
 --disable-x11-mbfonts --disable-x11-external --disable-raise-console --disable-wxwidgets \
 --without-libcerf --without-latex --without-kpsexpand --without-x --without-x-dcop \
 --without-aquaterm --without-readline --without-lua --without-row-help \
 --without-wx-multithreaded --without-bitmap-terminals --without-tektronix \
 --without-gpic --without-tgif --without-mif --without-regis --without-cairo --without-qt
emmake make -C src -j4 gnuplot CFLAGS='-O2' \
 LDFLAGS='-O2 -g0 -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker -sEXPORTED_RUNTIME_METHODS=FS,callMain,HEAPU8 -sINCOMING_MODULE_JS_API=wasmBinary,noFSInit,print,printErr -sINVOKE_RUN=0 -sEXIT_RUNTIME=0 -sINITIAL_MEMORY=67108864 -sSTACK_SIZE=5242880 -sDYNAMIC_EXECUTION=0 -sASSERTIONS=0'
cp src/gnuplot "$OUT/gnuplot.mjs"
cp src/gnuplot.wasm "$OUT/gnuplot.wasm"

cat > "$OUT/provenance.json" <<EOF
{
  "source": "https://downloads.sourceforge.net/project/gnuplot/gnuplot/$VERSION/gnuplot-$VERSION.tar.gz",
  "version": "$VERSION",
  "archiveSha256": "$ARCHIVE_SHA256",
  "patches": "none",
  "compiler": "emcc $EMCC",
  "script": "scripts/build-wasm.sh"
}
EOF
cd "$OUT"
shasum -a 256 gnuplot.mjs gnuplot.wasm provenance.json > SHA256SUMS
