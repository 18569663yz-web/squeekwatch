// @ts-check
/**
 * Squeekwatch badge renderer.
 *
 * Zero-dependency SVG badges, self-drawn in the spirit of shields.io but with the
 * Squeekchain ink/cream/orange palette: dark plate, mono uppercase text, squared
 * 3px corners, an accessible <title> and role="img".
 *
 * Contract (docs/INTERFACE.md):
 *   renderBadgeSvg({ label, value, color, labelColor }) -> string  (complete <svg>)
 *   renderStatusBadge(snapshot) -> string
 *   renderAuditBadge(audit)     -> string
 *
 * Every exporter is defensive: malformed or missing input renders a neutral badge
 * instead of throwing, because badges are embedded in READMEs and CI logs.
 */

const PALETTE = {
  ink: '#1A1A20',
  panel: '#22222A',
  line: '#33333D',
  cream: '#F2EAD3',
  orange: '#FF7A1A',
  red: '#C7362B',
  green: '#3FA46A',
  gray: '#8A8A93',
};

// Single quotes: the stack is embedded in a double-quoted SVG attribute.
const MONO_STACK =
  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

/** Advance width of one glyph at 11px in a typical monospace face (0.602em). */
const CHAR_W = 6.625;
const PADDING = 9;
const HEIGHT = 20;
const RADIUS = 3;

let clipSeq = 0;

/**
 * Escape the five XML metacharacters. Values come from chain/API data, so this is
 * the only thing standing between a hostile string and broken SVG.
 * @param {unknown} value
 * @returns {string}
 */
function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&apos;';
    }
  });
}

/**
 * Measured pixel width of a label/value run at 11px mono.
 * @param {string} text
 * @returns {number}
 */
function measure(text) {
  return Math.max(1, [...text].length) * CHAR_W;
}

/**
 * @param {string} hexString
 * @returns {{ r: number, g: number, b: number } | null}
 */
function parseHex(hexString) {
  const raw = String(hexString).trim().replace(/^#/, '');
  const expanded =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return null;
  return {
    r: parseInt(expanded.slice(0, 2), 16),
    g: parseInt(expanded.slice(2, 4), 16),
    b: parseInt(expanded.slice(4, 6), 16),
  };
}

/**
 * Relative luminance test so value text stays legible on any accent colour.
 * @param {string} color
 * @returns {boolean}
 */
function isDark(color) {
  const rgb = parseHex(color);
  if (!rgb) return true;
  const channel = (/** @type {number} */ c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const luminance =
    0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
  // Threshold tuned to the palette: orange (#FF7A1A, 0.35) and green (#3FA46A,
  // 0.29) carry ink text; red (#C7362B, 0.15) and gray carry cream text.
  return luminance < 0.25;
}

/**
 * Render a standalone badge.
 *
 * @param {{ label?: unknown, value?: unknown, color?: string, labelColor?: string }} [options]
 * @returns {string} a complete `<svg>` document fragment
 */
export function renderBadgeSvg(options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const label = String(opts.label == null ? '' : opts.label).toUpperCase();
  const value = String(opts.value == null ? '' : opts.value).toUpperCase();
  const color = parseHex(opts.color || '') ? String(opts.color) : PALETTE.orange;
  const labelColor = parseHex(opts.labelColor || '') ? String(opts.labelColor) : PALETTE.ink;

  const labelWidth = Math.round(measure(label) + PADDING * 2);
  const valueWidth = Math.round(measure(value) + PADDING * 2);
  const width = labelWidth + valueWidth;
  const valueInk = isDark(color) ? PALETTE.cream : PALETTE.ink;
  const clipId = 'sqkclip' + ++clipSeq;

  const title = label && value ? label + ': ' + value : label || value || 'Squeekwatch';

  const labelText = label
    ? '<text x="' +
      labelWidth / 2 +
      '" y="14" fill="' +
      PALETTE.cream +
      '">' +
      escapeXml(label) +
      '</text>'
    : '';
  const valueText = value
    ? '<text x="' +
      (labelWidth + valueWidth / 2) +
      '" y="14" fill="' +
      valueInk +
      '">' +
      escapeXml(value) +
      '</text>'
    : '';

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    width +
    '" height="' +
    HEIGHT +
    '" viewBox="0 0 ' +
    width +
    ' ' +
    HEIGHT +
    '" role="img" aria-label="' +
    escapeXml(title) +
    '">' +
    '<title>' +
    escapeXml(title) +
    '</title>' +
    '<defs><clipPath id="' +
    clipId +
    '"><rect width="' +
    width +
    '" height="' +
    HEIGHT +
    '" rx="' +
    RADIUS +
    '"/></clipPath></defs>' +
    '<g clip-path="url(#' +
    clipId +
    ')">' +
    (labelWidth > 0
      ? '<rect width="' + labelWidth + '" height="' + HEIGHT + '" fill="' + labelColor + '"/>'
      : '') +
    '<rect x="' +
    labelWidth +
    '" width="' +
    valueWidth +
    '" height="' +
    HEIGHT +
    '" fill="' +
    color +
    '"/>' +
    '</g>' +
    '<rect x="0.5" y="0.5" width="' +
    (width - 1) +
    '" height="' +
    (HEIGHT - 1) +
    '" rx="' +
    RADIUS +
    '" fill="none" stroke="' +
    PALETTE.line +
    '"/>' +
    '<g font-family="' +
    MONO_STACK +
    '" font-size="11" font-weight="700" letter-spacing="0.2" text-anchor="middle">' +
    labelText +
    valueText +
    '</g>' +
    '</svg>'
  );
}

/**
 * Safely read a dotted path off an arbitrary value.
 * @param {unknown} source
 * @param {string} dotted
 * @returns {unknown}
 */
function pick(source, dotted) {
  let cursor = source;
  for (const key of dotted.split('.')) {
    if (cursor == null || typeof cursor !== 'object') return undefined;
    cursor = /** @type {Record<string, unknown>} */ (cursor)[key];
  }
  return cursor;
}

/**
 * Parse a decimal integer string (base units, counter values) into a finite number.
 * @param {unknown} raw
 * @returns {number | null}
 */
function toNumber(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'bigint') return Number(raw);
  const text = String(raw).trim();
  if (!/^-?\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/**
 * Convert an 18-decimals base-unit string to a JS number without throwing.
 * @param {unknown} raw
 * @param {number} [decimals]
 * @returns {number | null}
 */
function fromBaseUnits(raw, decimals = 18) {
  if (raw == null || raw === '') return null;
  const text = String(raw).trim();
  if (!/^-?\d+$/.test(text)) return null;
  let big;
  try {
    big = BigInt(text);
  } catch {
    return null;
  }
  const negative = big < 0n;
  const abs = negative ? -big : big;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const frac = abs % scale;
  const numeric = Number(whole) + Number(frac) / 10 ** decimals;
  return negative ? -numeric : numeric;
}

/**
 * Compact token amount: 8.07M SQK, 2.10B SQK.
 * @param {unknown} raw base units string
 * @param {number} [decimals]
 * @returns {string | null}
 */
function compactAmount(raw, decimals = 18) {
  const numeric = fromBaseUnits(raw, decimals);
  if (numeric == null) return null;
  const abs = Math.abs(numeric);
  let text;
  if (abs >= 1e9) text = (numeric / 1e9).toFixed(2) + 'B';
  else if (abs >= 1e6) text = (numeric / 1e6).toFixed(2) + 'M';
  else if (abs >= 1e3) text = (numeric / 1e3).toFixed(2) + 'K';
  else if (abs >= 1) text = numeric.toFixed(2);
  else if (abs === 0) text = '0';
  else text = numeric.toPrecision(3);
  return text;
}

/**
 * Grouped integer string (2027 -> "2,027").
 * @param {unknown} raw
 * @returns {string | null}
 */
function grouped(raw) {
  const numeric = toNumber(raw);
  if (numeric == null) return null;
  return Math.trunc(numeric).toLocaleString('en-US');
}

/**
 * "hamster | BLOCK 2027 - 8.07M SQK" - the headline badge for a Snapshot.
 * @param {unknown} snapshot
 * @returns {string}
 */
export function renderStatusBadge(snapshot) {
  const block = grouped(
    pick(snapshot, 'status.builder.anchor.blockHeight') ??
      pick(snapshot, 'status.builder.projected.blockHeight'),
  );
  const symbol = String(pick(snapshot, 'economy.asset.symbol') || 'SQK');
  const decimals = toNumber(pick(snapshot, 'economy.asset.decimals')) ?? 18;
  const supply = compactAmount(
    pick(snapshot, 'economy.supply.liveSupplyBaseUnits') ??
      pick(snapshot, 'economy.supply.totalMintedBaseUnits'),
    decimals,
  );

  const parts = [];
  if (block) parts.push('BLOCK ' + block);
  if (supply) parts.push(supply + ' ' + symbol);

  return renderBadgeSvg({
    label: 'hamster',
    // U+00B7 middle dot keeps the value short and readable in a README.
    value: parts.length ? parts.join(' \u00B7 ') : 'NO DATA',
    color: PALETTE.orange,
  });
}

/**
 * "squeekwatch | VERIFIED 12/12" - the audit verdict badge.
 * @param {unknown} audit
 * @returns {string}
 */
export function renderAuditBadge(audit) {
  const rawVerdict = pick(audit, 'verdict');
  const verdict = rawVerdict ? String(rawVerdict).toUpperCase() : 'UNKNOWN';
  const pass = toNumber(pick(audit, 'pass'));
  const total = toNumber(pick(audit, 'total'));

  let value = verdict;
  const shownPass = pass == null ? null : Math.max(0, Math.trunc(pass));
  const shownTotal = total == null ? null : Math.max(0, Math.trunc(total));
  if (shownPass != null && shownTotal != null && shownTotal > 0) {
    value = verdict + ' ' + shownPass + '/' + shownTotal;
  }

  const color =
    verdict === 'VERIFIED'
      ? PALETTE.green
      : verdict === 'FAILED'
        ? PALETTE.red
        : verdict === 'DEGRADED'
          ? PALETTE.orange
          : PALETTE.gray;

  return renderBadgeSvg({ label: 'squeekwatch', value, color });
}
