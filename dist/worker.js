import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { ENGINE, FAILED, HEADER, LENGTH, READY, STARTED } from './protocol.js';
import { interpret } from './interpret.js';
import { outputPolicy } from './policy.js';
const ENOENT = 44;
const EFBIG = 22;
/** The terminal every fence is drawn with; the root's size is dropped, so this sets the aspect. */
const preamble = "set terminal svg size 1000,500 enhanced background rgb 'white'\nset output 'plot.svg'\n";
/** Characters of `print` output, warnings and errors kept per render. */
const diagnosticsChars = 16000;
const { buffer } = workerData;
const state = new Int32Array(buffer, 0, HEADER / 4);
const bytes = new Uint8Array(buffer, HEADER);
function write(text) {
    const encoded = new TextEncoder().encode(text);
    if (encoded.length > bytes.length)
        throw new RangeError('reply exceeds the shared buffer');
    bytes.set(encoded);
    Atomics.store(state, LENGTH, encoded.length);
    return encoded.length;
}
function reply(result) {
    try {
        write(JSON.stringify(result));
    }
    catch {
        write(JSON.stringify({ status: 'failure', message: 'gnuplot output is too large to return' }));
    }
    Atomics.store(state, READY, 1);
    Atomics.notify(state, READY);
}
async function start() {
    const engineFile = (name) => new URL(`../vendor/gnuplot/${name}`, import.meta.url);
    const factory = (await import(engineFile('gnuplot.mjs').href)).default;
    let diagnostics = '';
    const log = (line) => { if (diagnostics.length < diagnosticsChars)
        diagnostics += `${line}\n`; };
    const engine = await factory({
        wasmBinary: await readFile(engineFile('gnuplot.wasm')),
        noInitialRun: true, noFSInit: true, print: log, printErr: log
    });
    const fs = engine.FS;
    fs.init(() => null, null, null);
    fs.mkdir('/work');
    fs.chdir('/work');
    // No NODEFS is linked: the filesystem is memory only. Of it, a fence may open the plot file,
    // and read the script and the data files mounted for this render — nothing else.
    const dataNames = new Set();
    let mounting = false;
    const open = fs.open.bind(fs);
    fs.open = (path, flags, mode) => {
        const name = path.startsWith('/work/') ? path.slice('/work/'.length) : path;
        const reading = typeof flags === 'number' ? (flags & 3) === 0 && (flags & (64 | 512 | 1024)) === 0 : flags === 'r';
        if (!(name === 'plot.svg' || ((name === 'script.gp' || dataNames.has(name)) && (mounting || reading)))) {
            throw new fs.ErrnoError(ENOENT);
        }
        return open(path, flags, mode);
    };
    // The plot file lives outside the worker's heap limit, so its size is capped as it is written.
    let plotBytes = 0;
    let overflow = false;
    const writeStream = fs.write.bind(fs);
    fs.write = (stream, data, offset, length, position, canOwn) => {
        if (/(?:^|\/)plot\.svg$/.test(stream.path) && (position ?? stream.position) + length > plotBytes) {
            overflow = true;
            throw new fs.ErrnoError(EFBIG);
        }
        return writeStream(stream, data, offset, length, position, canOwn);
    };
    // Every render starts from the memory gnuplot had when it was ready, so no render can see or
    // change what an earlier one left behind.
    const snapshot = Uint8Array.from(engine.HEAPU8);
    return (request) => {
        const breach = outputPolicy(request.script);
        if (breach)
            return { status: 'failure', message: breach };
        diagnostics = '';
        overflow = false;
        // Room for the unsanitized SVG, which the sanitizer then measures exactly.
        plotBytes = 2 * request.outputBytes + 65536;
        const run = { exit: 1, diagnostics: '', overflow: false };
        try {
            mounting = true;
            for (const file of request.files) {
                dataNames.add(file.name);
                fs.writeFile(file.name, file.bytes);
            }
            fs.writeFile('script.gp', `${preamble}${request.script}\n`);
            mounting = false;
            run.exit = engine.callMain(['script.gp']);
            try {
                run.svg = fs.readFile('plot.svg', { encoding: 'utf8' });
            }
            catch { /* No plot was written. */ }
        }
        finally {
            mounting = false;
            for (const path of ['script.gp', 'plot.svg', ...dataNames]) {
                try {
                    fs.unlink(path);
                }
                catch { /* Absent after a failure. */ }
            }
            dataNames.clear();
            engine.HEAPU8.set(snapshot);
        }
        run.diagnostics = diagnostics;
        run.overflow = overflow;
        return interpret(run, request);
    };
}
start().then((render) => {
    parentPort.on('message', (request) => {
        let result;
        try {
            result = render(request);
        }
        catch {
            // An abort leaves the instance unusable; the host discards this worker.
            result = { status: 'failure', message: 'gnuplot stopped unexpectedly', discard: true };
        }
        reply(result);
    });
    Atomics.store(state, ENGINE, STARTED);
    Atomics.notify(state, ENGINE);
    parentPort.postMessage('started');
}, () => {
    // The error would name vendor paths on this machine; the reason stays plain and path-free.
    write('gnuplot could not start');
    Atomics.store(state, ENGINE, FAILED);
    Atomics.notify(state, ENGINE);
    parentPort.postMessage('failed');
});
