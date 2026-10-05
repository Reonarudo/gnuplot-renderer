import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRuntime, prepare } from '../dist/index.js';

const runtime = await createRuntime();
after(() => runtime.dispose());

/** Prepare a fence that names no data files; no reader is needed. */
const plain = (source: string) => prepare(source, {});

test('a function plot renders to inline-ready SVG with the renderer name as its only class', async () => {
  const result = runtime.render(await plain('plot sin(x)'));
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.match(result.output, /^<svg viewBox="0 0 1000 500" xmlns="http:\/\/www\.w3\.org\/2000\/svg" xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink" class="gnuplot">/);
  assert.match(result.output, /<\/svg>$/);
  assert.doesNotMatch(result.output, /<\?xml|<!--|<!DOCTYPE/);
  assert.doesNotMatch(result.output.slice(0, result.output.indexOf('>')), /\swidth=|\sheight=/);
  assert.deepEqual(result.notes, []);
});

test('functions, inline datablocks and 3D surfaces render', async () => {
  for (const source of [
    'set xrange [-10:10]\nplot sin(x), cos(x), atan(x)',
    '$data << EOD\n0 0\n1 1\n2 4\nEOD\nplot $data using 1:2 with linespoints',
    'set hidden3d\nsplot sin(sqrt(x*x+y*y))'
  ]) {
    const result = runtime.render(await plain(source));
    assert.equal(result.status, 'success', source);
  }
});

test('an error is plain text with its line in the fence body, the preamble subtracted', async () => {
  assert.deepEqual(runtime.render(await plain('set title "t"\nplot foo')), {
    status: 'failure', message: 'undefined variable: foo', line: 2
  });
});

test('a caret under the echoed line becomes a 1-based column, indentation included', async () => {
  // gnuplot puts this caret just past the end of the line: after `blah`, column 24.
  assert.deepEqual(runtime.render(await plain('set xrange [0:1]\n  plot sin(x) with blah')), {
    status: 'failure', message: 'unrecognized plot type', line: 2, column: 24
  });
  assert.deepEqual(runtime.render(await plain('x = 1/0\nplot x')), {
    status: 'failure', message: 'undefined value', line: 1, column: 5
  });
});

test('a fence that draws nothing is a failure', async () => {
  for (const source of ['', 'x = 1', 'print "only"']) {
    assert.deepEqual(runtime.render(await plain(source)), { status: 'failure', message: 'the fence draws no plot' }, JSON.stringify(source));
  }
});

test('print output and warnings of a successful plot become plain-text notes', async () => {
  const result = runtime.render(await plain('print "hi <b> & co"\nset xrange [1:0]\nplot x'));
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.deepEqual(result.notes, ['hi <b> & co']);
});

test('the output policy refuses terminal, output and script loading, but not quoted text', async () => {
  for (const source of ['set terminal dumb\nplot x', 'set output "x"\nplot x', 'set term png\nplot x']) {
    assert.deepEqual(runtime.render(await plain(source)), {
      status: 'failure', message: 'gnuplot-renderer controls the terminal and output; remove set terminal and set output'
    }, source);
  }
  for (const source of ['load "other.gp"\nplot x', 'call "other.gp"\nplot x']) {
    assert.deepEqual(runtime.render(await plain(source)), {
      status: 'failure', message: 'loading other gnuplot scripts is not supported'
    }, source);
  }
  assert.equal(runtime.render(await plain('set title "set terminal is unnecessary"\nplot x')).status, 'success');
});

test('shell escapes and host files are out of reach of a fence', async () => {
  const marker = '/tmp/gnuplot-renderer-shell-must-not-run';
  for (const source of [`system "touch ${marker}"\nplot x`, `!touch ${marker}\nplot x`,
    `a=system("touch ${marker}")\nplot x`, 'plot "<echo 1 2"', 'plot "/etc/passwd"']) {
    const result = runtime.render(await plain(source));
    assert.equal(existsSync(marker), false, source);
    assert.notEqual(result.status, 'timeout', source);
  }
  assert.equal(runtime.render(await plain('plot cos(x)')).status, 'success');
});

test('the vendored adapter has no host process or filesystem bridge', () => {
  assert.doesNotMatch(readFileSync('vendor/gnuplot/gnuplot.mjs', 'utf8'), /child_process|spawnSync|(?:var|const|let)\s+(?:NODEFS|NODERAWFS)\s*=/);
});

test('a runaway fence times out within its budget, and the next render on the runtime succeeds', async () => {
  // Starting gnuplot takes longer than this budget: the render after the timeout succeeds only
  // if the replacement's start is not charged to it.
  const quick = await createRuntime({ timeout: 100 });
  try {
    const started = performance.now();
    assert.deepEqual(quick.render(await plain('while (1) {}')), { status: 'timeout', budget: 100 });
    assert.ok(performance.now() - started < 1000);
    assert.equal(quick.render(await plain('plot x')).status, 'success');
    assert.equal(quick.render(await plain('plot x**2')).status, 'success');
  } finally {
    await quick.dispose();
  }
});

test('an engine that does not start in time makes that render unavailable, not the runtime', async () => {
  const slow = await createRuntime({ startupTimeout: 1 });
  try {
    assert.deepEqual(slow.render(await plain('plot x')), { status: 'unavailable', reason: 'gnuplot did not start within 1 ms' });
  } finally {
    await slow.dispose();
  }
});

test('invalid runtime options reject createRuntime', async () => {
  for (const options of [
    { timeout: 0 }, { timeout: -1 }, { timeout: Number.NaN }, { timeout: Infinity }, { startupTimeout: 0 },
    { limits: { sourceChars: 0 } }, { limits: { outputBytes: -5 } }, { limits: { sourceChars: Infinity } },
    { timeout: '100' }, { limits: null },
    { size: null }, { size: 800 }, { size: { width: 800 } }, { size: { width: 0, height: 500 } },
    { size: { width: 800.5, height: 500 } }, { size: { width: 800, height: -500 } },
    { size: { width: 10001, height: 500 } }, { size: { width: '800', height: 500 } }
  ]) {
    await assert.rejects(createRuntime(options as never), TypeError, JSON.stringify(options));
  }
});

test('render throws only for programmer errors: malformed input or a disposed runtime', async () => {
  const good = await plain('plot x');
  for (const input of [undefined, null, 'plot x', { source: 'plot x' }, { ...good, identity: 'x' },
    { ...good, files: [{ name: 'script.gp', label: 'a', bytes: new Uint8Array() }] },
    { ...good, files: [{ name: 'data-0.dat', label: 'a', bytes: 'x' }] }]) {
    assert.throws(() => runtime.render(input as never), TypeError, JSON.stringify(input));
  }
  const disposable = await createRuntime();
  await disposable.dispose();
  await disposable.dispose();
  assert.throws(() => disposable.render(good), /dispose/);
});

test('a source over the character limit is a failure naming the limit; one at the limit renders', async () => {
  const atLimit = 'plot x' + ' '.repeat(64000 - 6);
  assert.equal(runtime.render(await plain(atLimit)).status, 'success');
  assert.deepEqual(runtime.render(await plain(atLimit + ' ')), {
    status: 'failure', message: 'gnuplot source exceeds the 64000-character limit'
  });
});

test('limits are runtime options', async () => {
  const small = await createRuntime({ limits: { sourceChars: 10, outputBytes: 10000 } });
  try {
    assert.equal(small.render(await plain('plot 1')).status, 'success');
    assert.deepEqual(small.render(await plain('plot x + 1.0')), {
      status: 'failure', message: 'gnuplot source exceeds the 10-character limit'
    });
    assert.deepEqual(small.render(await plain('plot x,x*x')), {
      status: 'failure', message: 'gnuplot output exceeds the 10000-byte limit'
    });
  } finally {
    await small.dispose();
  }
});

test('the terminal size is a runtime option that sets the viewBox; the default stays 1000×500', async () => {
  const sized = await createRuntime({ size: { width: 800, height: 500 } });
  const explicit = await createRuntime({ size: { width: 1000, height: 500 } });
  try {
    const input = await plain('plot sin(x)');
    const result = sized.render(input);
    assert.equal(result.status, 'success');
    if (result.status !== 'success') return;
    assert.match(result.output, /^<svg viewBox="0 0 800 500" /);
    assert.deepEqual(explicit.render(input), runtime.render(input));
  } finally {
    await sized.dispose();
    await explicit.dispose();
  }
});

test('the default output limit is 4 MiB', async () => {
  // About 1.5 MB of path per 100 000 samples of one curve.
  assert.deepEqual(runtime.render(await plain('set samples 150000\nplot sin(x), cos(x), atan(x)')), {
    status: 'failure', message: 'gnuplot output exceeds the 4194304-byte limit'
  });
});

/** Every value of an attribute, in document order. */
const values = (svg: string, name: string): string[] =>
  [...svg.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'g'))].map((m) => m[1]!);

test('two plots on one page share no id, and every internal reference still resolves', async () => {
  const outputs: string[] = [];
  for (const source of ['plot sin(x) with points', 'plot cos(x) with points']) {
    const result = runtime.render(await plain(source));
    assert.equal(result.status, 'success');
    if (result.status === 'success') outputs.push(result.output);
  }
  const [one, two] = outputs.map((svg) => new Set(values(svg, 'id')));
  assert.ok(one!.size > 0);
  for (const id of one!) assert.ok(!two!.has(id), id);
  outputs.forEach((svg, index) => {
    const ids = [one, two][index]!;
    for (const id of ids) assert.match(id, /^gnuplot-[0-9a-f]{8}-/);
    const references = [...values(svg, 'xlink:href'), ...values(svg, 'href')].map((v) => v.slice(1));
    const urls = [...svg.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]!);
    assert.ok(references.length > 0);
    for (const target of [...references, ...urls]) assert.ok(ids.has(target), target);
    assert.doesNotMatch(svg, /<style/);
  });
});

test('the same input yields byte-identical output, also across runtimes', async () => {
  const input = await plain('set title "one"\nplot sin(x) with points, cos(x)');
  const other = await createRuntime();
  try {
    const first = runtime.render(input);
    assert.equal(first.status, 'success');
    assert.deepEqual(runtime.render(input), first);
    assert.deepEqual(other.render(await plain('set title "one"\nplot sin(x) with points, cos(x)')), first);
  } finally {
    await other.dispose();
  }
});

/** Every attribute value in the SVG's tags, except namespace declarations. Text is left out. */
const attributeValues = (svg: string): string[] => [...svg.matchAll(/<[^>]*>/g)]
  .flatMap((tag) => [...tag[0].matchAll(/\s(?!xmlns[=:])[\w:-]+="([^"]*)"/g)].map((m) => m[1]!));

test('markup, script and links in labels stay inert text', async () => {
  const source = [
    'set title "<script>alert(1)</script>"',
    'set xlabel "<foreignObject><img src=x onerror=alert(1)></foreignObject>"',
    `set ylabel "x' onload='alert(1)"`,
    'set label 1 "<a href=\'javascript:alert(1)\'>j</a>" at 0,0',
    'set label 2 "data:text/html,1 https://evil.example/t" at 1,1',
    'set label 3 "<image href=\\"https://evil.example/x.png\\"/>" at 2,2',
    'plot x title "<svg onload=alert(1)>"'
  ].join('\n');
  const result = runtime.render(await plain(source));
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  const tags = new Set([...result.output.matchAll(/<\/?([\w:-]+)/g)].map((m) => m[1]!));
  for (const tag of ['script', 'foreignObject', 'image', 'a', 'img']) assert.ok(!tags.has(tag), tag);
  assert.doesNotMatch(result.output, /<[^>]*\son\w+=/);
  for (const value of attributeValues(result.output)) assert.doesNotMatch(value, /javascript:|data:|https?:|url\((?!#)/);
  assert.match(result.output, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('messages and notes from malformed fences are plain text', async () => {
  for (const source of ['plot <script>', 'set title "<b>" \nplot x with <img>', 'f(x) = <svg>\nplot f(x)', 'plot sin(x) title <b>x</b>']) {
    const result = runtime.render(await plain(source));
    assert.equal(result.status, 'failure', source);
    if (result.status !== 'failure') continue;
    assert.doesNotMatch(result.message, /[<>]|&\w+;|\/Users|\/home|\/work|vendor|script\.gp/, source);
  }
});

test('a message quoting a data operand quotes it as the author wrote it, as plain text', async () => {
  assert.deepEqual(runtime.render(await plain('plot "<b>x</b>.csv"')), {
    status: 'failure', message: 'data files must be relative paths inside the content root: "<b>x</b>.csv"', line: 1, column: 6
  });
});
