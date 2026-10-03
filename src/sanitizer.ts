import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { Element } from '@xmldom/xmldom';
type ChildNode = Element['childNodes'][number];

// The allowlist is the extension's, unchanged (ADR 0004): passive SVG geometry, text, gnuplot's
// point markers and background filters, and local references only.
const svgNamespace = 'http://www.w3.org/2000/svg';
const elements = new Set(('svg g defs path rect circle ellipse line polyline polygon text tspan title desc use clipPath ' +
  'pattern linearGradient radialGradient stop filter feFlood feComposite feBlend').split(' '));
const attributes = new Set(('id x y x1 y1 x2 y2 dx dy cx cy r rx ry width height viewBox preserveAspectRatio d points ' +
  'transform fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin ' +
  'stroke-dasharray stroke-dashoffset opacity font-family font-size font-weight font-style text-anchor ' +
  'dominant-baseline textLength lengthAdjust rotate clip-path clipPathUnits patternUnits patternTransform ' +
  'patternContentUnits gradientUnits gradientTransform offset stop-color stop-opacity filter filterUnits result in ' +
  'in2 operator mode flood-color flood-opacity color xmlns xmlns:xlink href xlink:href').split(' '));
const localReference = /^#[A-Za-z_][\w:.-]*$/;
const localUrl = /^url\(#[A-Za-z_][\w:.-]*\)$/;
/** Values that could reach outside the plot, whatever attribute carries them. */
const reaching = /\\|javascript:|data:|https?:|\/\//i;

const refused = 'gnuplot produced SVG that could not be sanitized';

/** Thrown when the sanitized SVG would exceed the output limit. */
export class OutputTooLarge extends Error {}

export interface SanitizeOptions {
  /** Prepended to every id and every reference to one: `gnuplot-<8 hex>-`. */
  prefix: string;
  /** Mounted data-file names (`data-0.dat`) and the operand the author wrote for each. */
  labels?: ReadonlyMap<string, string>;
  /** UTF-8 bytes the result may take. */
  outputBytes: number;
}

/**
 * Parse gnuplot's SVG as XML, keep only the allowlisted elements and attributes, namespace every
 * id and local reference, and restore the author's data-file names in text. The root keeps its
 * `viewBox` and the class `gnuplot`, nothing that sizes it. Throws, with a fixed plain message,
 * on anything that is not a well-formed SVG document, and `OutputTooLarge` past the limit.
 */
export function sanitizeSvg(source: string, { prefix, labels = new Map(), outputBytes }: SanitizeOptions): string {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error(refused);
  let root: Element | null;
  try {
    root = new DOMParser({ onError: () => { throw new Error(); } }).parseFromString(source, 'image/svg+xml').documentElement;
  } catch {
    // The parser's own message quotes the offending markup, which may be author-controlled.
    throw new Error(refused);
  }
  if (!root || root.tagName !== 'svg' || root.namespaceURI !== svgNamespace) throw new Error(refused);

  let textBytes = 0;
  const clean = (el: Element): void => {
    for (const attr of Array.from(el.attributes)) {
      const { name, value } = attr;
      if (!attributes.has(name) ||
          ((name === 'href' || name === 'xlink:href') && !localReference.test(value)) ||
          (/url\s*\(/i.test(value) && !localUrl.test(value)) ||
          (reaching.test(value) && !name.startsWith('xmlns'))) {
        el.removeAttributeNode(attr);
      } else if (name === 'id') {
        el.setAttribute(name, prefix + value);
      } else if (name === 'href' || name === 'xlink:href') {
        el.setAttribute(name, '#' + prefix + value.slice(1));
      } else if (localUrl.test(value)) {
        el.setAttribute(name, `url(#${prefix}${value.slice(5)}`);
      }
    }
    for (const child of Array.from(el.childNodes) as ChildNode[]) {
      if (child.nodeType === 1) {
        const element = child as Element;
        if (element.namespaceURI !== svgNamespace || !elements.has(element.tagName)) el.removeChild(child);
        else clean(element);
      } else if (child.nodeType !== 3) {
        el.removeChild(child);
      } else if (child.nodeValue) {
        // Text only; serialization escapes the restored names.
        textBytes += child.nodeValue.length;
        child.nodeValue = child.nodeValue.replace(/data-\d+\.dat/g, (name) => {
          const label = labels.get(name) ?? name;
          textBytes += label.length - name.length;
          if (textBytes > outputBytes) throw new OutputTooLarge();
          return label;
        });
      }
    }
  };
  clean(root);
  if (!root.hasAttribute('viewBox')) throw new Error(refused);
  root.removeAttribute('width');
  root.removeAttribute('height');
  root.setAttribute('class', 'gnuplot');
  const output = new XMLSerializer().serializeToString(root);
  if (Buffer.byteLength(output, 'utf8') > outputBytes) throw new OutputTooLarge();
  return output;
}
