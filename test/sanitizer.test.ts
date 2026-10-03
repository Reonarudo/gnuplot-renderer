import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OutputTooLarge, sanitizeSvg } from '../src/sanitizer.js';

const wrap = (content: string): string =>
  `<?xml version="1.0" encoding="utf-8"  standalone="no"?>\n<svg width="1000" height="500" viewBox="0 0 1000 500" ` +
  `xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${content}</svg>`;
const options = { prefix: 'gnuplot-0123abcd-', outputBytes: 4 * 1024 * 1024 };

test('removes executable markup and remote resources', () => {
  const output = sanitizeSvg(wrap('<script>alert(1)</script><foreignObject><div>bad</div></foreignObject>' +
    '<image href="https://bad"/><g onclick="bad()" style="fill:url(https://bad)"><path fill="url(https://bad)"/>' +
    '<use xlink:href="javascript:bad()"/><animate attributeName="href"/></g><a href="https://bad"><text>x</text></a>'), options);
  assert.doesNotMatch(output, /script|foreignObject|image|onclick|style=|https:|javascript:|animate|<a/);
});

test('keeps geometry, enhanced text and filters; namespaces every id and local reference', () => {
  const output = sanitizeSvg(wrap('<defs><path id="gpPt0" d="M0 0L1 1"/><filter id="textbox"><feFlood flood-color="white"/>' +
    '</filter></defs><use xlink:href="#gpPt0"/><use href="#gpPt0"/><g filter="url(#textbox)"><text><tspan font-size="12">' +
    'α &amp; β</tspan></text></g>'), options);
  assert.equal(output, '<svg viewBox="0 0 1000 500" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" class="gnuplot">' +
    '<defs><path id="gnuplot-0123abcd-gpPt0" d="M0 0L1 1"/><filter id="gnuplot-0123abcd-textbox"><feFlood flood-color="white"/>' +
    '</filter></defs><use xlink:href="#gnuplot-0123abcd-gpPt0"/><use href="#gnuplot-0123abcd-gpPt0"/>' +
    '<g filter="url(#gnuplot-0123abcd-textbox)"><text><tspan font-size="12">α &amp; β</tspan></text></g></svg>');
});

test('rejects malformed, entity-bearing and non-SVG documents with a fixed message', () => {
  for (const source of ['<html/>', '<!DOCTYPE svg [<!ENTITY a "bad">]>' + wrap(''), wrap('<path>'),
    '<svg xmlns="http://www.w3.org/2000/svg"/>']) {
    assert.throws(() => sanitizeSvg(source, options), { message: 'gnuplot produced SVG that could not be sanitized' }, source);
  }
});

test('mounted data names are restored only as escaped text, never recursively', () => {
  const labels = new Map([['data-0.dat', 'data/a & <b>.csv'], ['data-1.dat', 'data-0.dat']]);
  const output = sanitizeSvg(wrap('<text>data-0.dat data-1.dat</text><path id="data-0.dat"/>'), { ...options, labels });
  assert.match(output, /<text>data\/a &amp; &lt;b&gt;\.csv data-0\.dat<\/text>/);
  assert.match(output, /id="gnuplot-0123abcd-data-0\.dat"/);
});

test('restored names count toward the output limit while they are restored', () => {
  const labels = new Map([['data-0.dat', 'x'.repeat(5000)]]);
  assert.throws(() => sanitizeSvg(wrap('<text>' + 'data-0.dat '.repeat(1000) + '</text>'), { ...options, labels, outputBytes: 100000 }), OutputTooLarge);
});
