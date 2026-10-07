/* BASELINE SNAPSHOT — tests/ui/_baseline-style.js (TASK 1.1)
 *
 * Captures the on-disk baseline of public/style.css BEFORE any visual-refinement
 * edit. This module is the authority for the invariance tests (Properties 1, 2, 3
 * in design.md) consumed by tests/ui/visual-refinement.test.js (task 9.1).
 *
 * It reads the CURRENT file content from disk, so the snapshot reflects the real
 * AgendaCar palette and layout geometry present at capture time — NOT the legacy
 * literals (#27c0d4 / #070a12 / #3a5bd0) that still appear in tokens.test.js.
 *
 * Parsing follows the project convention in this folder: no browser, no CSS AST,
 * just tolerant regexes over the raw string read with node:fs.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const STYLE_CSS_PATH = join(here, '..', '..', 'public', 'style.css');

/** Read the current on-disk style.css. */
export function readStyleCss() {
  return readFileSync(STYLE_CSS_PATH, 'utf8');
}

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

// A conservative set of CSS named colors that the design actually could use.
// Kept small on purpose: the AgendaCar palette is literal/hex driven, so the
// named-color branch mainly exists to not silently drop something like
// `transparent`/`white`/`black` if it ever shows up as a token value.
const NAMED_COLORS = new Set([
  'transparent', 'currentcolor', 'white', 'black', 'red', 'green', 'blue',
  'orange', 'cyan', 'gray', 'grey', 'silver', 'navy', 'teal', 'yellow',
  'purple', 'maroon', 'olive', 'lime', 'aqua', 'fuchsia',
]);

/** True when a declaration VALUE looks like it carries a color. */
export function isColorValue(value) {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  if (/#[0-9a-f]{3,8}\b/.test(v)) return true;              // #hex (3/4/6/8)
  if (/\brgba?\s*\(/.test(v)) return true;                   // rgb() / rgba()
  if (/\bhsla?\s*\(/.test(v)) return true;                   // hsl() / hsla()
  if (/\blinear-gradient\s*\(/.test(v)) return true;         // gradient
  if (/\bradial-gradient\s*\(/.test(v)) return true;
  // var() pointing at a color-ish token (--ac-*, --accent*, --surface*, etc.)
  if (/\bvar\(\s*--(ac-|accent|primary|surface|sidebar|bg|text|muted|line|cyan|green|red|orange|info|purple|on-accent)/.test(v)) {
    return true;
  }
  // bare named color used as the whole value
  if (NAMED_COLORS.has(v)) return true;
  return false;
}

/** Extract the body (text between the outermost braces) of the first rule
 *  whose selector matches `selectorRe`. Returns '' when not found. */
export function ruleBody(css, selectorRe) {
  const re = new RegExp(selectorRe.source + '\\s*\\{([^{}]*)\\}', selectorRe.flags.includes('i') ? 'i' : '');
  const m = css.match(re);
  return m ? m[1] : '';
}

/** Read a single `prop: value` out of a rule body. Returns null when absent. */
export function declaration(body, prop) {
  const re = new RegExp('(?:^|;)\\s*' + prop.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\s*:\\s*([^;}]+)', 'i');
  const m = body.match(re);
  return m ? m[1].trim() : null;
}

// ---------------------------------------------------------------------------
// Property 1 — color token map from :root
// ---------------------------------------------------------------------------

/** Isolate the first `:root { ... }` block (body only). */
export function rootBody(css) {
  const m = css.match(/:root\s*\{([\s\S]*?)\}/i);
  return m ? m[1] : '';
}

/**
 * Build a { name -> value } map of every :root custom property whose value is a
 * color (hex / rgb(a) / hsl(a) / named / gradient / var() to a color token).
 * This is the authority for Property 1 (palette invariance).
 */
export function captureColorTokens(css = readStyleCss()) {
  const body = rootBody(css);
  const map = {};
  const declRe = /(--[a-z0-9-]+)\s*:\s*([^;{}]+);/gi;
  let m;
  while ((m = declRe.exec(body)) !== null) {
    const name = m[1].trim();
    const value = m[2].trim();
    if (isColorValue(value)) {
      map[name] = value;
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Property 2 — the set of distinct color literals in the whole file
// ---------------------------------------------------------------------------

/**
 * Collect the set of distinct color LITERALS anywhere in the file: hex colors,
 * rgb/rgba(...) and hsl/hsla(...) function calls (normalized by whitespace).
 * var() references are intentionally NOT literals. Used for Property 2 (no new
 * color introduced => post set ⊆ baseline set).
 */
export function captureColorLiterals(css = readStyleCss()) {
  const set = new Set();

  // #hex (3/4/6/8 digits), lower-cased for stable comparison.
  const hexRe = /#[0-9a-fA-F]{3,8}\b/g;
  let m;
  while ((m = hexRe.exec(css)) !== null) {
    set.add(m[0].toLowerCase());
  }

  // rgb()/rgba()/hsl()/hsla() calls — normalize inner whitespace so that
  // "rgba(0,0,0,0.1)" and "rgba(0, 0, 0, .1)" are treated per their raw text.
  const funcRe = /\b(?:rgba?|hsla?)\s*\([^)]*\)/gi;
  while ((m = funcRe.exec(css)) !== null) {
    const normalized = m[0].toLowerCase().replace(/\s+/g, '');
    set.add(normalized);
  }

  return set;
}

// ---------------------------------------------------------------------------
// Property 3 — layout geometry invariants
// ---------------------------------------------------------------------------

/** Count the grid tracks declared by a `grid-template-columns` value.
 *  Expands `repeat(N, track)` to N and ignores auto-fit/auto-fill keyword forms
 *  (recorded as the literal count the author wrote, e.g. repeat(6, 1fr) => 6;
 *  repeat(auto-fit, ...) => 'auto'). */
export function countTracks(value) {
  const v = value.trim();
  const repeat = v.match(/repeat\(\s*([^,]+),/i);
  if (repeat) {
    const n = repeat[1].trim();
    if (/^\d+$/.test(n)) return Number(n);
    return n; // 'auto-fit' | 'auto-fill'
  }
  // plain track list: count whitespace-separated tokens.
  return v.split(/\s+/).filter(Boolean).length;
}

/** Every `grid-template-columns` declaration with its selector context and the
 *  resolved track count. Order matches source order for stable comparison. */
export function captureGridTemplates(css = readStyleCss()) {
  const results = [];
  // selector (greedy-safe) up to the brace that contains grid-template-columns.
  const re = /([^{}]+)\{([^{}]*grid-template-columns\s*:\s*([^;}]+)[^{}]*)\}/gi;
  let m;
  while ((m = re.exec(css)) !== null) {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    const value = m[3].trim();
    results.push({ selector, value, tracks: countTracks(value) });
  }
  return results;
}

/**
 * Capture the layout-geometry invariants that Property 3 freezes:
 *  - --sidebar-width
 *  - .app-shell display
 *  - .app-main margin-left
 *  - main max-width
 *  - presence of the 900px and 600px breakpoints
 *  - every grid-template-columns track count
 */
export function captureLayoutGeometry(css = readStyleCss()) {
  const root = rootBody(css);
  const appShell = ruleBody(css, /\.app-shell/i);
  const appMain = ruleBody(css, /\.app-main/i);
  const mainRule = ruleBody(css, /(?:^|[\s,}])main/i);

  return {
    sidebarWidth: declaration(root, '--sidebar-width'),
    appShellDisplay: declaration(appShell, 'display'),
    appMainMarginLeft: declaration(appMain, 'margin-left'),
    mainMaxWidth: declaration(mainRule, 'max-width'),
    has900Breakpoint: /@media[^{]*\(\s*max-width:\s*900px\s*\)/i.test(css),
    has600Breakpoint: /@media[^{]*\(\s*max-width:\s*600px\s*\)/i.test(css),
    gridTemplates: captureGridTemplates(css),
  };
}

// ---------------------------------------------------------------------------
// Aggregate snapshot
// ---------------------------------------------------------------------------

/** Capture the complete baseline snapshot from the current on-disk file. */
export function captureBaseline(css = readStyleCss()) {
  const colorTokens = captureColorTokens(css);
  const colorLiterals = captureColorLiterals(css);
  const layout = captureLayoutGeometry(css);
  return {
    colorTokens,
    // expose the literal set both as a Set (ergonomic) and a sorted array
    // (serializable / snapshot-friendly).
    colorLiterals,
    colorLiteralList: [...colorLiterals].sort(),
    layout,
  };
}

/**
 * The frozen baseline, captured from the on-disk style.css at module load.
 * Later tests import this to assert invariance after refinement edits.
 */
export const BASELINE = captureBaseline();

export default BASELINE;
