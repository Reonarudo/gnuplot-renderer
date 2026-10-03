import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntime, nodeFileReader, prepare, type FileReader } from '../dist/index.js';

const runtime = await createRuntime();
after(() => runtime.dispose());

let temp: string;
let root: string;
before(async () => {
  temp = await realpath(await mkdtemp(join(tmpdir(), 'gnuplot-renderer-files-')));
  root = join(temp, 'content');
  await mkdir(join(root, 'posts', 'data'), { recursive: true });
  await writeFile(join(root, 'posts', 'data', 'a.csv'), 'x,y,z\n0,0,1\n1,2,2\n2,3,4\n');
  await writeFile(join(root, 'posts', 'b.dat'), '0 1\n1 4\n2 7\n');
  await writeFile(join(root, 'shared.csv'), '0,5\n1,6\n');
  await writeFile(join(temp, 'secret.csv'), '0,2\n');
});
after(() => rm(temp, { recursive: true, force: true }));

const reader = (): FileReader => nodeFileReader({ root, document: join(root, 'posts', 'post.md') });
const decode = (read: Awaited<ReturnType<FileReader['read']>>): string =>
  'bytes' in read ? new TextDecoder().decode(read.bytes) : `error: ${read.error}`;

test('the node file reader reads keys relative to the Markdown file, inside the root', async () => {
  assert.equal(decode(await reader().read('data/a.csv', { maxBytes: 1024 })), 'x,y,z\n0,0,1\n1,2,2\n2,3,4\n');
  assert.equal(decode(await reader().read('../shared.csv', { maxBytes: 1024 })), '0,5\n1,6\n');
});

test('the node file reader refuses escapes, symlinks, folders, missing and oversized files, without a path', async () => {
  await symlink(join(temp, 'secret.csv'), join(root, 'posts', 'link.csv'));
  await symlink(temp, join(root, 'posts', 'linked'), 'dir');
  const cases: [string, number, string][] = [
    ['../../secret.csv', 1024, 'error: the file is outside the content root'],
    ['/etc/passwd', 1024, 'error: the file is outside the content root'],
    ['link.csv', 1024, 'error: symbolic links are not followed'],
    ['linked/secret.csv', 1024, 'error: symbolic links are not followed'],
    ['data', 1024, 'error: not a regular file'],
    ['missing.csv', 1024, 'error: file not found'],
    ['data/a.csv', 10, 'error: the file exceeds the 10-byte limit']
  ];
  for (const [key, maxBytes, expected] of cases) {
    const result = decode(await reader().read(key, { maxBytes }));
    assert.equal(result, expected, key);
    assert.ok(!result.includes(temp), key);
  }
});

test('the node file reader takes absolute paths and rejects anything else', () => {
  assert.throws(() => nodeFileReader({ root: 'content', document: join(root, 'post.md') }), TypeError);
  assert.throws(() => nodeFileReader({ root, document: 'post.md' }), TypeError);
  assert.throws(() => nodeFileReader(undefined as never), TypeError);
});

test('preparation finds only file operands, across comments, labels, functions and datablocks', async () => {
  const source = 'set title "not.csv"\n# plot "comment.csv"\n$d << EOD\nplot "datablock.csv"\nEOD\n' +
    'set datafile separator comma\nplot sin(x), "./data/a.csv" using 1:2 title "title.csv", \\\n "b.dat" with lines, \'\' using 1:3';
  const asked: string[] = [];
  const prepared = await prepare(source, { reader: { read: async (key, options) => { asked.push(key); return reader().read(key, options); } } });
  assert.equal(prepared.failure, undefined);
  assert.deepEqual(asked, ['data/a.csv', 'b.dat']);
  assert.deepEqual(prepared.files.map(({ name, key, label }) => ({ name, key, label })), [
    { name: 'data-0.dat', key: 'data/a.csv', label: './data/a.csv' },
    { name: 'data-1.dat', key: 'b.dat', label: 'b.dat' }
  ]);
  assert.match(prepared.script, /plot sin\(x\), "data-0.dat" using 1:2 title "title.csv", \\\n "data-1.dat" with lines/);
  assert.match(prepared.script, /plot "datablock.csv"/);
});

test('data files render, with the operand as written in the key, and reading never leaks into the next render', async () => {
  const source = 'set datafile separator comma\nplot "./data/a.csv" using 1:2 with lines, "" using 1:3, "../shared.csv" using 1:2';
  const result = runtime.render(await prepare(source, { reader: reader() }));
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.match(result.output, />"\.\/data\/a\.csv" using 1:2</);
  assert.match(result.output, />"\.\.\/shared\.csv" using 1:2</);
  assert.doesNotMatch(result.output, /data-\d\.dat/);
  assert.equal(runtime.render(await prepare('set datafile separator comma\nsplot "data/a.csv" using 1:2:3', { reader: reader() })).status, 'success');
  // A file mounted for one render is gone in the next, even under its mounted name.
  const after = runtime.render(await prepare('plot "data-0.dat"', { reader: { read: async () => ({ error: 'not here' }) } }));
  assert.equal(after.status, 'failure');
});

test('a fence cannot overwrite its own data file', async () => {
  const plot = 'set datafile separator comma\nplot "data/a.csv" using 1:2';
  const baseline = runtime.render(await prepare(plot, { reader: reader() }));
  const overwrite = runtime.render(await prepare(`set print "data/a.csv"\nprint "999,999"\n${plot}`, { reader: reader() }));
  assert.equal(baseline.status, 'success');
  assert.equal(overwrite.status, 'success');
  if (baseline.status !== 'success' || overwrite.status !== 'success') return;
  assert.equal(overwrite.output.replace(/gnuplot-[0-9a-f]{8}-/g, ''), baseline.output.replace(/gnuplot-[0-9a-f]{8}-/g, ''));
});

test('an author-facing data-file problem is a failure located at the operand', async () => {
  const cases: [string, string, number, number][] = [
    ['plot sin(x)\nplot "/etc/passwd"', 'data files must be relative paths inside the content root: "/etc/passwd"', 2, 6],
    ['plot "data.gp"', 'only .csv, .dat and .txt data files are supported: "data.gp"', 1, 6],
    ['plot "data" . ".csv"', 'computed data filenames are not supported; use a literal relative filename', 1, 6],
    ['plot x\n  plot "unclosed.csv', 'unterminated quoted string', 2, 8],
    ['plot "missing.csv"', 'cannot load data file "missing.csv": file not found', 1, 6]
  ];
  for (const [source, message, line, column] of cases) {
    assert.deepEqual(runtime.render(await prepare(source, { reader: reader() })), { status: 'failure', message, line, column }, source);
  }
});

test('a fence naming data files without a reader is a failure, not a crash', async () => {
  assert.deepEqual(runtime.render(await prepare('plot "a.csv"')), {
    status: 'failure', message: 'this fence plots data files, but no file reader was given to read them'
  });
  const throwing: FileReader = { read: async () => { throw new Error('/secret/path'); } };
  assert.deepEqual(runtime.render(await prepare('plot "a.csv"', { reader: throwing })), {
    status: 'failure', message: 'cannot load data file "a.csv": the file reader failed', line: 1, column: 6
  });
});

test('preparation limits default to 16 files, 1 MiB each and 4 MiB together, and can be changed', async () => {
  const many = 'plot ' + Array.from({ length: 17 }, (_, i) => `"f${i}.csv"`).join(', ');
  assert.equal((await prepare(many, { reader: reader() })).failure?.message, 'a plot can name at most 16 data files');
  const big = (size: number): FileReader => ({ read: async (key, { maxBytes }) => {
    assert.equal(maxBytes, 1024 * 1024);
    return { bytes: new Uint8Array(size) };
  } });
  assert.equal((await prepare('plot "a.csv"', { reader: big(1024 * 1024 + 1) })).failure?.message,
    'cannot load data file "a.csv": it exceeds the 1048576-byte limit');
  const five = 'plot ' + Array.from({ length: 5 }, (_, i) => `"f${i}.csv"`).join(', ');
  assert.equal((await prepare(five, { reader: big(1024 * 1024) })).failure?.message,
    'cannot load data file "f4.csv": the fence\'s data files exceed the 4194304-byte limit together');
  const two = 'plot "a.csv", "b.csv"';
  assert.equal((await prepare(two, { reader: reader(), limits: { files: 1 } })).failure?.message, 'a plot can name at most 1 data files');
  for (const limits of [{ files: 0 }, { totalBytes: -1 }, { fileBytes: Infinity }, { files: Number.NaN }]) {
    await assert.rejects(prepare('plot x', { limits }), TypeError, JSON.stringify(limits));
  }
});

test('the identity covers the fence and each file\'s key and content, and no absolute path', async () => {
  const fixed = (text: string): FileReader => ({ read: async () => ({ bytes: new TextEncoder().encode(text) }) });
  const base = await prepare('plot "a.csv"', { reader: fixed('0 1\n') });
  assert.match(base.identity, /^[0-9a-f]{64}$/);
  // Same fence and bytes from another reader, anywhere on disk: same identity.
  assert.equal((await prepare('plot "a.csv"', { reader: fixed('0 1\n') })).identity, base.identity);
  assert.notEqual((await prepare('plot "a.csv"', { reader: fixed('0 2\n') })).identity, base.identity);
  assert.notEqual((await prepare('plot "a.csv" ', { reader: fixed('0 1\n') })).identity, base.identity);
  assert.notEqual((await prepare('plot "a.csv"', { reader: { read: async () => ({ error: 'gone' }) } })).identity, base.identity);
  const real = await prepare('plot "data/a.csv"', { reader: reader() });
  const elsewhere = await prepare('plot "data/a.csv"', { reader: fixed('x,y,z\n0,0,1\n1,2,2\n2,3,4\n') });
  assert.equal(real.identity, elsewhere.identity);
});
