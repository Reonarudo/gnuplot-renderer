import { Worker } from 'node:worker_threads';
import { ENGINE, FAILED, HEADER, LENGTH, READY, STARTED, STARTING } from './protocol.js';
/** Whether a value has the shape `prepare` gives, so the engine is never handed anything else. */
function isPrepared(input) {
    if (typeof input !== 'object' || input === null)
        return false;
    const { source, script, files, identity, failure } = input;
    return typeof source === 'string' && typeof script === 'string' &&
        typeof identity === 'string' && /^[0-9a-f]{64}$/.test(identity) &&
        (failure === undefined || (typeof failure === 'object' && failure !== null &&
            typeof failure.message === 'string')) &&
        Array.isArray(files) && files.every((file) => {
        const { name, label, bytes } = (file ?? {});
        return typeof name === 'string' && /^data-\d+\.dat$/.test(name) && typeof label === 'string' && bytes instanceof Uint8Array;
    }) && new Set(files.map((file) => file.name)).size === files.length;
}
/** A runtime-wide option: absent for its default, else a finite positive number. */
function option(value, name, fallback) {
    if (value === undefined)
        return fallback;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new TypeError(`${name} must be a finite positive number`);
    }
    return value;
}
/** The largest terminal width or height accepted, in SVG units. */
const maxSize = 10000;
/** The terminal size: absent for its default, else two integers from 1 to `maxSize`. */
function terminalSize(value) {
    if (value === undefined)
        return { width: 1000, height: 500 };
    if (typeof value !== 'object' || value === null)
        throw new TypeError('size must be an object');
    const { width, height } = value;
    for (const [name, side] of [['width', width], ['height', height]]) {
        if (!Number.isInteger(side) || side < 1 || side > maxSize) {
            throw new TypeError(`size.${name} must be an integer from 1 to ${maxSize}`);
        }
    }
    return { width: width, height: height };
}
export async function createRuntime(options = {}) {
    if (typeof options !== 'object' || options === null)
        throw new TypeError('options must be an object');
    if (options.limits !== undefined && (typeof options.limits !== 'object' || options.limits === null)) {
        throw new TypeError('limits must be an object');
    }
    const timeout = option(options.timeout, 'timeout', 3000);
    const startupTimeout = option(options.startupTimeout, 'startupTimeout', 10000);
    const size = terminalSize(options.size);
    const sourceChars = option(options.limits?.sourceChars, 'limits.sourceChars', 64000);
    const outputBytes = option(options.limits?.outputBytes, 'limits.outputBytes', 4 * 1024 * 1024);
    // JSON at most doubles sanitized SVG (quotes and newlines escape to two bytes); the slack holds
    // the envelope and a failure message.
    const capacity = 2 * outputBytes + 65536;
    let worker;
    let state;
    let bytes;
    let disposed = false;
    const spawn = () => {
        // Each worker gets its own buffer: a terminated worker still finishing a render must not be
        // able to write its late answer where its replacement's answer is expected.
        const buffer = new SharedArrayBuffer(HEADER + capacity);
        state = new Int32Array(buffer, 0, HEADER / 4);
        bytes = new Uint8Array(buffer, HEADER);
        worker = new Worker(new URL('./worker.js', import.meta.url), {
            workerData: { buffer, size },
            env: {},
            stdout: true,
            stderr: true,
            resourceLimits: { maxOldGenerationSizeMb: 128 }
        });
        // Emscripten reports an abort on stderr; the render learns of it through its reply.
        worker.stdout.resume();
        worker.stderr.resume();
        // A crash surfaces to the waiting render as a timeout; this only keeps it from being fatal.
        worker.on('error', () => { });
        worker.unref();
        return worker;
    };
    const stop = () => {
        void worker?.terminate();
        worker = undefined;
    };
    const payload = () => new TextDecoder().decode(bytes.slice(0, Atomics.load(state, LENGTH)));
    // Start the first engine now, so the first fence does not wait for it. Not fatal if it fails:
    // the next render starts a fresh one.
    spawn();
    await new Promise((resolve) => {
        const started = worker;
        const timer = setTimeout(done, startupTimeout);
        function done() {
            clearTimeout(timer);
            started.off('message', done);
            resolve();
        }
        started.on('message', done);
    });
    return {
        render(input) {
            if (disposed)
                throw new Error('render() called after dispose()');
            if (!isPrepared(input))
                throw new TypeError('render() takes what prepare() returned for the fence');
            const { source } = input;
            if (source.length > sourceChars) {
                return { status: 'failure', message: `gnuplot source exceeds the ${sourceChars}-character limit` };
            }
            if (input.failure)
                return { status: 'failure', ...input.failure };
            if (!worker)
                spawn();
            if (Atomics.load(state, ENGINE) === STARTING)
                Atomics.wait(state, ENGINE, STARTING, startupTimeout);
            const engine = Atomics.load(state, ENGINE);
            if (engine !== STARTED) {
                const why = engine === FAILED ? payload() : `gnuplot did not start within ${startupTimeout} ms`;
                stop();
                return { status: 'unavailable', reason: why };
            }
            Atomics.store(state, READY, 0);
            const request = {
                source,
                script: input.script,
                files: input.files.map(({ name, label, bytes }) => ({ name, label, bytes })),
                prefix: `gnuplot-${input.identity.slice(0, 8)}-`,
                outputBytes
            };
            worker.postMessage(request);
            if (Atomics.wait(state, READY, 0, timeout) === 'timed-out') {
                stop();
                return { status: 'timeout', budget: timeout };
            }
            const { discard, ...result } = JSON.parse(payload());
            if (discard)
                stop();
            return result;
        },
        async dispose() {
            disposed = true;
            const last = worker;
            worker = undefined;
            await last?.terminate();
        }
    };
}
