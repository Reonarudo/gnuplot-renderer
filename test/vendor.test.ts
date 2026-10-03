import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRuntime, prepare } from '../dist/index.js';

test('vendored files match SHA256SUMS', () => {
  const sums = readFileSync('vendor/gnuplot/SHA256SUMS', 'utf8').trim().split('\n');
  assert.deepEqual(sums.map((line) => line.split(/\s+/)[1]).sort(), ['gnuplot.mjs', 'gnuplot.wasm', 'provenance.json']);
  for (const line of sums) {
    const [expected, name] = line.split(/\s+/) as [string, string];
    const actual = createHash('sha256').update(readFileSync(`vendor/gnuplot/${name}`)).digest('hex');
    assert.equal(actual, expected, name);
  }
});

test('the vendored engine is the unmodified gnuplot 6.0.2 release, built with emcc 6.0.9', async () => {
  const provenance = JSON.parse(readFileSync('vendor/gnuplot/provenance.json', 'utf8'));
  assert.equal(provenance.version, '6.0.2');
  assert.equal(provenance.archiveSha256, 'f68a3b0bbb7bbbb437649674106d94522c00bf2f285cce0c19c3180b1ee7e738');
  assert.equal(provenance.patches, 'none');
  assert.equal(provenance.compiler, 'emcc 6.0.9');
  const runtime = await createRuntime();
  try {
    const result = runtime.render(await prepare('print GPVAL_VERSION, GPVAL_PATCHLEVEL\nplot x'));
    assert.equal(result.status, 'success');
    if (result.status === 'success') assert.deepEqual(result.notes, ['6.0 2']);
  } finally {
    await runtime.dispose();
  }
});
