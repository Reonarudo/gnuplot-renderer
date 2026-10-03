/** Int32 slots at the head of the shared buffer. */
export const READY = 0;
export const LENGTH = 1;
export const ENGINE = 2;
/** Values of the ENGINE slot. */
export const STARTING = 0;
export const STARTED = 1;
export const FAILED = 2;
export const HEADER = 12;
/** Lines the library writes before the fence body: `set terminal` and `set output`. */
export const PREAMBLE_LINES = 2;
