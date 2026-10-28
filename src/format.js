// @ts-check
/**
 * Tiny terminal formatting helpers: colour, number compaction, tables, bars.
 * Everything degrades to plain ASCII when stdout is not a TTY or NO_COLOR is set.
 */

const ESC = '\u001b[';
export const supportsColor = Boolean(process.stdout?.isTTY) && !process.env.NO_COLOR && process.env.TERM !== 'dumb';

/** @type {Record<string, string>} */
const TONES = {
  reset: '0',
  bold: '1',
  dim: '2',
  red: '31',
  green: '32',
  yellow: '33',
  blue: '34',
  magenta: '35',
  cyan: '36',
  gray: '38;5;245',
  orange: '38;5;208',
  cream: '38;5;223',
  invert: '7',
};

/**
 * Wrap text in an ANSI colour when colour is enabled.
 * `color(text, 'orange')` is the primary form; `color.orange(text)` is a shorthand.
 * @param {unknown} text
 * @param {string} [tone]
 * @param {boolean} [enabled]
 */
export function color(text, tone = 'reset', enabled = supportsColor) {
  const value = String(text);
  if (!enabled) return value;
  const code = TONES[tone];
  if (!code) return value;
  return `${ESC}${code}m${value}${ESC}0m`;
}

for (const tone of Object.keys(TONES)) {
  // @ts-expect-error attach shorthand helpers onto the function object
  color[tone] = (text, enabled = supportsColor) => color(text, tone, enabled);
}

/** @param {string} text */
export function stripAnsi(text) {
  return String(text).replace(/\u001b\[[0-9;]*m/g, '');
}

/**
 * Split a base-unit integer into a decimal string without floating point.
 * @param {bigint|number|string} value
 * @param {number} [decimals]
 * @param {number} [fractionDigits]
 */
export function baseUnits(value, decimals = 18, fractionDigits = 6) {
  const big = typeof value === 'bigint' ? value : BigInt(String(value));
  const negative = big < 0n;
  const abs = negative ? -big : big;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const raw = (abs % base).toString().padStart(decimals, '0');
  const fraction = raw.slice(0, fractionDigits).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole.toString()}${fraction ? `.${fraction}` : ''}`;
}

/**
 * Compact a base-unit amount into a human string: "8.07M", "2.10B", "1,234".
 * @param {bigint|number|string} value
 * @param {{decimals?: number, digits?: number}} [opts]
 */
export function compact(value, opts = {}) {
  const { decimals = 18, digits = 2 } = opts;
  const big = typeof value === 'bigint' ? value : BigInt(String(value));
  const base = 10n ** BigInt(decimals);
  const whole = Number(big / base);
  const fraction = Number(big % base) / Number(base);
  const scaled = whole + fraction;
  if (scaled === 0) return '0';
  /** @type {Array<[number, string]>} */
  const units = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [limit, suffix] of units) {
    if (Math.abs(scaled) >= limit) return `${(scaled / limit).toFixed(digits)}${suffix}`;
  }
  return scaled.toFixed(digits > 0 && scaled < 100 ? digits : 0);
}

/**
 * Human token amount from base units, e.g. `8066546793063427114304839` -> "8.07M SQK".
 * @param {bigint|number|string|undefined|null} value
 * @param {{decimals?: number, digits?: number, symbol?: string}} [opts]
 */
export function token(value, opts = {}) {
  const { decimals = 18, digits = 2, symbol = '' } = opts;
  if (value === null || value === undefined) return 'n/a';
  const text = compact(value, { decimals, digits });
  return symbol ? `${text} ${symbol}` : text;
}

/** @param {bigint|number|string} numerator @param {bigint|number|string} denominator @param {number} [digits] */
export function percent(numerator, denominator, digits = 3) {
  const n = Number(String(numerator));
  const d = Number(String(denominator));
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return 'n/a';
  return `${((n / d) * 100).toFixed(digits)}%`;
}

/** @param {string|null|undefined} iso */
export function ago(iso, now = Date.now()) {
  if (!iso) return 'n/a';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'n/a';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

/** @param {number} seconds */
export function duration(seconds) {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const hours = Math.floor(s / 3600);
  if (hours < 48) return `${hours}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** @param {number} value @param {number} max @param {number} [width] */
export function bar(value, max, width = 24) {
  const ratio = max <= 0 ? 0 : Math.max(0, Math.min(1, value / max));
  const filled = Math.round(ratio * width);
  return `${'#'.repeat(filled)}${'-'.repeat(Math.max(0, width - filled))}`;
}

/** @param {unknown} value @param {number} width */
export function padEnd(value, width) {
  const text = String(value);
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

/** @param {unknown} value @param {number} width */
export function padStart(value, width) {
  const text = String(value);
  return text.length >= width ? text : ' '.repeat(width - text.length) + text;
}

/** @param {unknown} text @param {number} width */
export function truncate(text, width) {
  const clean = String(text);
  return clean.length <= width ? clean : `${clean.slice(0, Math.max(0, width - 1))}...`;
}

/**
 * Render a simple aligned table. Column widths are computed on the ANSI-stripped text.
 * @param {string[]} headers
 * @param {Array<Array<string|number>>} rows
 * @param {{align?: Array<'left'|'right'>, indent?: string, enabled?: boolean}} [opts]
 */
export function table(headers, rows, opts = {}) {
  const { align = headers.map(() => 'left'), indent = '  ', enabled = supportsColor } = opts;
  const widths = headers.map((header, index) => {
    const cells = [header, ...rows.map((row) => String(row[index] ?? ''))];
    return Math.max(...cells.map((cell) => stripAnsi(cell).length));
  });
  /** @param {Array<string|number>} cells */
  const line = (cells) =>
    indent +
    cells
      .map((cell, index) => {
        const text = String(cell ?? '');
        return align[index] === 'right' ? padStart(text, widths[index]) : padEnd(text, widths[index]);
      })
      .join('  ')
      .trimEnd();
  return [line(headers.map((h) => color(h, 'dim', enabled))), ...rows.map(line)].join('\n');
}

/**
 * Horizontal separator line, optionally with a centred title.
 * @param {string} [title]
 * @param {number} [width]
 * @param {boolean} [enabled]
 */
export function rule(title = '', width = 78, enabled = supportsColor) {
  if (!title) return color('-'.repeat(width), 'dim', enabled);
  const text = ` ${title} `;
  const left = Math.max(0, Math.floor((width - text.length) / 2));
  return color(`${'-'.repeat(left)}${text}${'-'.repeat(Math.max(0, width - left - text.length))}`, 'dim', enabled);
}

/** @param {string} text @param {number} [width] */
export function wrap(text, width = 78) {
  const words = String(text).split(/\s+/);
  /** @type {string[]} */
  const lines = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > width) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = (current + ' ' + word).trim();
    }
  }
  if (current) lines.push(current);
  return lines.join('\n');
}
