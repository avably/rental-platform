import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const artifactPath = `${root}/docs/branding/2026-07-20-avably-faza-2-system.html`;
const hubPath = `${root}/docs/dokumentacja/hub.html`;

assert.ok(existsSync(artifactPath), `Brak artefaktu Fazy 2: ${artifactPath}`);
const html = readFileSync(artifactPath, "utf8");
const css = html.match(/<style id="phase2-theme">([\s\S]*?)<\/style>/)?.[1] ?? "";

export const parseCssDeclarations = (body) =>
  new Map(
    body
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(";")
      .map((declaration) => declaration.trim())
      .filter((declaration) => declaration.includes(":"))
      .map((declaration) => {
        const colon = declaration.indexOf(":");
        return [
          declaration.slice(0, colon).trim(),
          declaration.slice(colon + 1).trim().replace(/\s+/g, " "),
        ];
      }),
  );

export const extractBalancedCssBody = (source, anchor) => {
  const anchorIndex = source.indexOf(anchor);
  if (anchorIndex === -1) return "";
  const openIndex = source.indexOf("{", anchorIndex + anchor.length);
  if (openIndex === -1) return "";
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return source.slice(openIndex + 1, index);
  }
  return "";
};

const voidTags = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
  "meta", "source", "track", "wbr",
]);

const parseAttributes = (raw) => {
  const attributes = {};
  for (const match of raw.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const [, name, doubleQuoted, singleQuoted, bare] = match;
    attributes[name] = doubleQuoted ?? singleQuoted ?? bare ?? "";
  }
  return attributes;
};

export const parseHtml = (source) => {
  const root = { tag: "#document", attributes: {}, children: [], start: 0, end: source.length, parent: null };
  const stack = [root];
  let cursor = 0;
  for (const match of source.matchAll(/<!--[\s\S]*?-->|<!doctype[^>]*>|<\/?[a-z][^>]*>/gi)) {
    if (match.index > cursor) {
      stack.at(-1).children.push({ tag: "#text", value: source.slice(cursor, match.index) });
    }
    cursor = match.index + match[0].length;
    if (/^<!--|^<!doctype/i.test(match[0])) continue;
    const closing = /^<\//.test(match[0]);
    const tag = match[0].match(/^<\/?\s*([a-z][\w:-]*)/i)?.[1].toLowerCase();
    if (closing) {
      const node = stack.pop();
      assert.equal(node.tag, tag, `Niepoprawnie zagnieżdżony </${tag}>`);
      node.end = cursor;
      continue;
    }
    const rawAttributes = match[0]
      .replace(/^<\s*[a-z][\w:-]*/i, "")
      .replace(/\/?>$/, "");
    const node = {
      tag,
      attributes: parseAttributes(rawAttributes),
      children: [],
      start: match.index,
      end: cursor,
      openTag: match[0],
      parent: stack.at(-1),
    };
    stack.at(-1).children.push(node);
    if (!voidTags.has(tag) && !/\/\s*>$/.test(match[0])) stack.push(node);
  }
  if (cursor < source.length) root.children.push({ tag: "#text", value: source.slice(cursor) });
  assert.equal(stack.length, 1, `Niedomknięty element <${stack.at(-1).tag}>`);
  return root;
};

export const directChildren = (node, predicate) =>
  node.children.filter((child) => child.tag !== "#text" && predicate(child));

export const findAll = (node, predicate, matches = []) => {
  if (node.tag !== "#text" && predicate(node)) matches.push(node);
  for (const child of node.children ?? []) findAll(child, predicate, matches);
  return matches;
};

export const textContent = (node) => node.tag === "#text"
  ? node.value
  : (node.children ?? []).map(textContent).join("");

export const decodeHtmlEntities = (value) => value
  .replaceAll("&lt;", "<")
  .replaceAll("&gt;", ">")
  .replaceAll("&quot;", '"')
  .replaceAll("&#39;", "'")
  .replaceAll("&amp;", "&");

const tree = parseHtml(html);

assert.match(html, /^<!doctype html>/i);
assert.match(html, /<html lang="pl" data-brand-system="avably-phase-2">/);
assert.equal((html.match(/<style\b/g) ?? []).length, 1);
assert.match(html, /<style id="phase2-theme">/);
const networkProbe = html.replaceAll("http://www.w3.org/2000/svg", "");
assert.doesNotMatch(networkProbe, /https?:\/\//i);
assert.doesNotMatch(html, /<(?:link|iframe|object|embed)\b/i);
assert.doesNotMatch(html, /<script\b[^>]*\bsrc\s*=/i);
assert.doesNotMatch(html, /\bsrcset\s*=/i);
for (const match of html.matchAll(/\b(src|poster|href)\s*=\s*(["'])(.*?)\2/gi)) {
  const [, attribute, , value] = match;
  if (attribute.toLowerCase() === "href") {
    assert.match(value, /^#[A-Za-z][\w:.-]*$|^#$/, `Niedozwolony href: ${value}`);
  } else {
    assert.match(value, /^data:/, `Niedozwolony ${attribute}: ${value}`);
  }
}
for (const [, value] of html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
  assert.match(value, /^data:|^#[A-Za-z][\w:.-]*$|^#$/, `Niedozwolony CSS url(): ${value}`);
}
assert.doesNotMatch(html, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|import\s*\()/);
const fontFaces = [...html.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)].map(([, body]) => body);
assert.equal(fontFaces.length, 5);
assert.equal((html.match(/data:font\/woff2;base64,/g) ?? []).length, 5);
const expectedFaces = [
  { family: "Safiro", weight: "500", count: 1 },
  { family: "Manrope", weight: "400 700", count: 2 },
  { family: "Geist Sans", weight: "400 600", count: 2 },
];
for (const { family, weight, count } of expectedFaces) {
  const matches = fontFaces.filter((body) => body.includes(`font-family: "${family}"`));
  assert.equal(matches.length, count);
  for (const body of matches) {
    assert.match(body, new RegExp(`font-weight:\\s*${weight.replace(" ", "\\s+")}`));
    assert.match(body, /font-style:\s*normal/);
    assert.match(body, /font-display:\s*swap/);
    assert.match(body, /src:\s*url\(data:font\/woff2;base64,/);
  }
}
for (const family of ["Manrope", "Geist Sans"]) {
  const matches = fontFaces.filter((body) => body.includes(`font-family: "${family}"`));
  assert.equal(matches.filter((body) => body.includes("U+0100-02BA")).length, 1);
  assert.equal(matches.filter((body) => body.includes("U+0000-00FF")).length, 1);
}
assert.match(html, /font-synthesis:\s*none/);
assert.doesNotMatch(html, /font-family:\s*["']?Geist Mono/i);
assert.doesNotMatch(html, /font-family:[^;}]*(?:monospace|ui-monospace)/i);

const requiredSections = [
  "foundations", "marks", "dashboard", "orders-light", "order-detail",
  "product-form", "states", "storefront", "orders-dark", "motion", "handoff",
];
const phaseSections = findAll(tree, (node) => node.attributes["data-phase2-section"]);
assert.deepEqual(
  phaseSections.map((node) => node.attributes["data-phase2-section"]).filter((value) => value !== "opening"),
  requiredSections,
);

const surfacePhases = phaseSections
  .map((node) => node.attributes["data-surface-phase"])
  .filter(Boolean)
  .filter((phase, index, phases) => index === 0 || phase !== phases[index - 1]);
assert.deepEqual(surfacePhases, ["white", "dark", "lime"]);

for (const family of ["Safiro", "Manrope", "Geist Sans"]) {
  assert.match(html, new RegExp(`font-family:\\s*"${family}"`), `Brak fontu ${family}`);
}
assert.match(html, /data:font\/woff2;base64,/);
assert.doesNotMatch(html, /Papier roboczy|Czarna rama/);

// ===== Task 2: colour math, tokens, carriers, contrast =====
const normalizeHex = (hex) => hex.toUpperCase();
const baseColors = {
  canvas: "#F4F6F5",
  surface: "#FFFFFF",
  ink: "#0B1017",
  muted: "#55616D",
  border: "#7E8994",
  lime: "#EAFFA4",
  dot: "#A8C743",
};
const hexToRgb = (hex) => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
const srgbToLinear = (channel) => channel <= 0.04045
  ? channel / 12.92
  : ((channel + 0.055) / 1.055) ** 2.4;

export const hexToOklch = (hex) => {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear);
  const lRoot = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mRoot = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const sRoot = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const l = 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot;
  const a = 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot;
  const bAxis = 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot;
  const c = Math.hypot(a, bAxis);
  const h = (Math.atan2(bAxis, a) * 180 / Math.PI + 360) % 360;
  return { l, c, h };
};

const linearToSrgb = (channel) => channel <= 0.0031308
  ? 12.92 * channel
  : 1.055 * channel ** (1 / 2.4) - 0.055;

export const oklchToHex = ({ l, c, h }) => {
  const radians = h * Math.PI / 180;
  const a = c * Math.cos(radians);
  const bAxis = c * Math.sin(radians);
  const lRoot = l + 0.3963377774 * a + 0.2158037573 * bAxis;
  const mRoot = l - 0.1055613458 * a - 0.0638541728 * bAxis;
  const sRoot = l - 0.0894841775 * a - 1.291485548 * bAxis;
  const lCube = lRoot ** 3;
  const mCube = mRoot ** 3;
  const sCube = sRoot ** 3;
  const channels = [
    4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube,
    -1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube,
    -0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube,
  ];
  return `#${channels.map((channel) => Math.round(
    Math.min(1, Math.max(0, linearToSrgb(channel))) * 255,
  ).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
};

const relativeLuminance = (hex) => {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const contrastRatio = (foreground, background) => {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)]
    .sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
};

const formatOklch = ({ l, c, h }) => `${l.toFixed(5)} ${c.toFixed(5)} ${h.toFixed(2)}`;

const selfTestColorMath = () => {
  assert.equal(contrastRatio("#0B1017", "#FFFFFF").toFixed(2), "19.08");
  assert.equal(formatOklch(hexToOklch("#F4F6F5")), "0.97135 0.00250 165.08");
  assert.equal(oklchToHex({ l: 0.97135, c: 0.00250, h: 165.08 }), "#F4F6F5");
};

const lightTokens = {
  background: "#F4F6F5", foreground: "#0B1017", card: "#FFFFFF",
  "card-foreground": "#0B1017", popover: "#FFFFFF", "popover-foreground": "#0B1017",
  primary: "#0B1017", "primary-foreground": "#FFFFFF", secondary: "#E7EBE8",
  "secondary-foreground": "#0B1017", muted: "#E9ECEA", "muted-foreground": "#55616D",
  accent: "#EAFFA4", "accent-foreground": "#0B1017", destructive: "#A93226",
  "destructive-foreground": "#FFFFFF", border: "#7E8994", input: "#7E8994", ring: "#0B1017",
  "chart-1": "#0067A5", "chart-2": "#A85C00", "chart-3": "#007C6B",
  "chart-4": "#7A5195", "chart-5": "#B23A48", sidebar: "#FFFFFF",
  "sidebar-foreground": "#0B1017", "sidebar-primary": "#0B1017",
  "sidebar-primary-foreground": "#FFFFFF", "sidebar-accent": "#EAFFA4",
  "sidebar-accent-foreground": "#0B1017", "sidebar-border": "#7E8994", "sidebar-ring": "#0B1017",
};

const darkTokens = {
  background: "#0B1017", foreground: "#F4F6F5", card: "#111820",
  "card-foreground": "#F4F6F5", popover: "#111820", "popover-foreground": "#F4F6F5",
  primary: "#EAFFA4", "primary-foreground": "#0B1017", secondary: "#1A232C",
  "secondary-foreground": "#F4F6F5", muted: "#1A232C", "muted-foreground": "#B8C0C5",
  accent: "#263016", "accent-foreground": "#EAFFA4", destructive: "#FF8A7A",
  "destructive-foreground": "#0B1017", border: "#7E8994", input: "#7E8994", ring: "#EAFFA4",
  "chart-1": "#4DB4FF", "chart-2": "#FFB85C", "chart-3": "#43C9AD",
  "chart-4": "#C493E0", "chart-5": "#FF7F8C", sidebar: "#111820",
  "sidebar-foreground": "#F4F6F5", "sidebar-primary": "#EAFFA4",
  "sidebar-primary-foreground": "#0B1017", "sidebar-accent": "#263016",
  "sidebar-accent-foreground": "#EAFFA4", "sidebar-border": "#7E8994", "sidebar-ring": "#EAFFA4",
};

const requiredContrasts = {
  "ink-on-white": { foreground: "#0B1017", background: "#FFFFFF", minimum: 4.5, kind: "text" },
  "ink-on-canvas": { foreground: "#0B1017", background: "#F4F6F5", minimum: 4.5, kind: "text" },
  "white-on-ink": { foreground: "#FFFFFF", background: "#0B1017", minimum: 4.5, kind: "text" },
  "muted-on-white": { foreground: "#55616D", background: "#FFFFFF", minimum: 4.5, kind: "text" },
  "ink-on-lime": { foreground: "#0B1017", background: "#EAFFA4", minimum: 4.5, kind: "text" },
  "border-on-white": { foreground: "#7E8994", background: "#FFFFFF", minimum: 3, kind: "ui" },
  "border-on-canvas": { foreground: "#7E8994", background: "#F4F6F5", minimum: 3, kind: "ui" },
  "signal-on-white": { foreground: "#5F7500", background: "#FFFFFF", minimum: 3, kind: "ui" },
  "signal-on-canvas": { foreground: "#5F7500", background: "#F4F6F5", minimum: 3, kind: "ui" },
  "signal-on-lime": { foreground: "#5F7500", background: "#EAFFA4", minimum: 3, kind: "ui" },
};

const assertContrastRegistry = (expected) => {
  const rows = findAll(tree, (node) => "data-contrast-pair" in node.attributes);
  assert.deepEqual(rows.map((node) => node.attributes["data-contrast-pair"]), Object.keys(expected));
  for (const row of rows) {
    const id = row.attributes["data-contrast-pair"];
    const contract = expected[id];
    assert.equal(row.attributes["data-foreground"], contract.foreground);
    assert.equal(row.attributes["data-background"], contract.background);
    assert.equal(row.attributes["data-kind"], contract.kind);
    assert.equal(Number(row.attributes["data-minimum"]), contract.minimum);
    const ratio = contrastRatio(contract.foreground, contract.background);
    assert.ok(ratio >= contract.minimum, `${id}: ${ratio} < ${contract.minimum}`);
    assert.equal(row.attributes["data-ratio"], ratio.toFixed(2));
    assert.ok(textContent(row).includes(`${ratio.toFixed(2)}:1`));
  }
  const referenceIds = [...new Set(
    findAll(tree, (node) => "data-contrast-ref" in node.attributes)
      .flatMap((node) => node.attributes["data-contrast-ref"].split(/\s+/)),
  )];
  assert.deepEqual(referenceIds.sort(), Object.keys(expected).sort());
};

// Task 4/5 grow requiredContrasts before this single invocation runs.
const CONTRAST_REGISTRY_CALL = true;

const expectedDiagnostics = {
  "lime-on-white": ["#EAFFA4", "#FFFFFF"],
  "lime-on-canvas": ["#EAFFA4", "#F4F6F5"],
  "dot-on-white": ["#A8C743", "#FFFFFF"],
};
const diagnostics = findAll(tree, (node) => "data-contrast-diagnostic" in node.attributes);
assert.deepEqual(diagnostics.map((node) => node.attributes["data-contrast-diagnostic"]), Object.keys(expectedDiagnostics));
for (const diagnostic of diagnostics) {
  const [foreground, background] = expectedDiagnostics[diagnostic.attributes["data-contrast-diagnostic"]];
  assert.equal(diagnostic.attributes["data-allowed"], "false");
  assert.ok(contrastRatio(foreground, background) < 3);
  assert.match(textContent(diagnostic), /NIEDOZWOLONE/);
}

selfTestColorMath();

const baseSwatches = findAll(tree, (node) => "data-base-color" in node.attributes);
assert.equal(baseSwatches.length, 7);
assert.deepEqual(
  Object.fromEntries(baseSwatches.map((node) => [node.attributes["data-base-color"], node.attributes["data-hex"]])),
  baseColors,
);
const signalStrong = findAll(tree, (node) => node.attributes["data-system-color"] === "signal-strong");
assert.equal(signalStrong.length, 1);
assert.equal(signalStrong[0].attributes["data-hex"], "#5F7500");

const angularDistance = (left, right) => {
  const distance = Math.abs(left - right) % 360;
  return Math.min(distance, 360 - distance);
};

export const assertThemeTokens = (themeSelector, expectedHexMap) => {
  const body = extractBalancedCssBody(css, themeSelector);
  assert.ok(body, `Brak bloku ${themeSelector}`);
  const rows = [...body.matchAll(
    /--([\w-]+):\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)\s*;\s*\/\*\s*(#[0-9A-F]{6})\s*\*\//gi,
  )].map(([, name, l, c, h, hex]) => ({
    name, declared: { l: Number(l), c: Number(c), h: Number(h) }, hex: hex.toUpperCase(),
  }));
  const expectedNames = Object.keys(expectedHexMap);
  const actual = new Map(rows.map((row) => [row.name, row]));
  assert.deepEqual(rows.map((row) => row.name), expectedNames);
  for (const [name, expectedHex] of Object.entries(expectedHexMap)) {
    const row = actual.get(name);
    assert.ok(row, `Brak tokenu ${themeSelector} --${name}`);
    assert.equal(row.hex, expectedHex);
    const calculated = hexToOklch(expectedHex);
    assert.ok(Math.abs(row.declared.l - calculated.l) <= 0.000006, `${name}: błędne L`);
    assert.ok(Math.abs(row.declared.c - calculated.c) <= 0.000006, `${name}: błędne C`);
    if (calculated.c >= 0.00001) {
      assert.ok(angularDistance(row.declared.h, calculated.h) <= 0.011, `${name}: błędne H`);
    }
    assert.equal(oklchToHex(row.declared), expectedHex, `${name}: OKLCH nie wraca do HEX`);
  }
};

assertThemeTokens(":root", { ...lightTokens, "signal-strong": "#5F7500" });
assertThemeTokens(".dark", darkTokens);
const rootDeclarations = parseCssDeclarations(extractBalancedCssBody(css, ":root"));
assert.deepEqual(
  Object.fromEntries(["--radius", "--radius-sm", "--radius-md", "--radius-lg", "--radius-xl"]
    .map((name) => [name, rootDeclarations.get(name)])),
  {
    "--radius": "1rem", "--radius-sm": "0.625rem", "--radius-md": "0.75rem",
    "--radius-lg": "1rem", "--radius-xl": "1.25rem",
  },
);
assert.equal(rootDeclarations.get("--signal-strong"), "oklch(0.52561 0.12715 121.752)");

const hasAncestor = (node, predicate) => {
  for (let current = node.parent; current; current = current.parent) {
    if (predicate(current)) return true;
  }
  return false;
};
const carrierKinds = new Set(["ink-text", "ink-border", "signal-strong", "dark-surface"]);
const limeUses = findAll(tree, (node) => "data-lime-use" in node.attributes);
assert.ok(limeUses.length > 0);
for (const node of limeUses) {
  assert.ok(carrierKinds.has(node.attributes["data-lime-carrier"]), `Błędny lime carrier przy ${node.attributes["data-lime-use"]}`);
}
const cssRuleBlocks = [...css.replace(/@font-face\s*\{[\s\S]*?\}/g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selector, body]) => ({ selector, body, declarations: parseCssDeclarations(body) }));
const referencedVariables = (value) => [...(value ?? "").matchAll(/var\((--[\w-]+)/g)].map(([, name]) => name);
const collectPaintAliases = (literal, initial = []) => {
  const aliases = new Set(initial);
  let changed = true;
  while (changed) {
    changed = false;
    for (const { declarations } of cssRuleBlocks) {
      for (const [property, value] of declarations) {
        if (!property.startsWith("--") || aliases.has(property)) continue;
        if (value.toUpperCase().includes(literal) || referencedVariables(value).some((name) => aliases.has(name))) {
          aliases.add(property);
          changed = true;
        }
      }
    }
  }
  return aliases;
};
const limeAliases = collectPaintAliases("#EAFFA4", ["--accent"]);
const dotAliases = collectPaintAliases("#A8C743", ["--dot"]);
const usesPaintFamily = (value, literal, aliases) =>
  (value ?? "").toUpperCase().includes(literal) || referencedVariables(value).some((name) => aliases.has(name));
const isPaintProperty = (property) => /^(?:color|background(?:-color)?|border(?:-[\w-]+)?|outline(?:-color)?|fill|stroke)$/i.test(property);
const hasExplicitLimeCarrier = (body) =>
  /(?:color|border(?:-[\w-]+)?|outline)\s*:[^;]*(?:#0B1017|var\(--(?:foreground|primary-foreground|accent-foreground)\))/i.test(body);

for (const { selector, body, declarations } of cssRuleBlocks) {
  const paintedValues = [...declarations].filter(([property]) => isPaintProperty(property)).map(([, value]) => value);
  const usesLime = paintedValues.some((value) => usesPaintFamily(value, "#EAFFA4", limeAliases));
  const usesDot = paintedValues.some((value) => usesPaintFamily(value, "#A8C743", dotAliases));
  if (!usesLime && !usesDot) continue;
  for (const branch of selector.split(",").map((value) => value.trim()).filter(Boolean)) {
    if (usesLime) {
      assert.ok(
        /\[data-lime-use\]|\[data-brand-sign\]/.test(branch) || hasExplicitLimeCarrier(body),
        `Limonkowy paint bez nośnika: ${branch}`,
      );
    }
    if (usesDot) assert.match(branch, /\[data-brand-sign\]/, `Brand dot poza znakiem: ${branch}`);
  }
}

const nodeOrAncestor = (node, predicate) => predicate(node) || hasAncestor(node, predicate);
for (const node of findAll(tree, (candidate) => ["fill", "stroke", "style"].some(
  (name) => usesPaintFamily(candidate.attributes[name], "#A8C743", dotAliases),
))) {
  const isDefinition = nodeOrAncestor(node, (candidate) => candidate.tag === "symbol");
  assert.ok(isDefinition || nodeOrAncestor(node, (candidate) => "data-brand-sign" in candidate.attributes), "#A8C743 poza znakiem marki");
}
for (const node of findAll(tree, (candidate) => ["fill", "stroke", "style"].some(
  (name) => usesPaintFamily(candidate.attributes[name], "#EAFFA4", limeAliases),
))) {
  const isDefinition = nodeOrAncestor(node, (candidate) => candidate.tag === "symbol");
  const hasCarrier = nodeOrAncestor(node, (candidate) =>
    "data-lime-use" in candidate.attributes || "data-brand-sign" in candidate.attributes,
  );
  assert.ok(isDefinition || hasCarrier, "Limonkowy paint inline bez nośnika");
}

// Hard CSS bans — focus visibility uses border + outline, so these do not weaken keyboard focus.
for (const banned of [
  "linear-gradient(", "radial-gradient(", "conic-gradient(", "box-shadow",
  "backdrop-filter", "blur(", "drop-shadow(", "perspective", "rotateX(", "rotateY(",
]) {
  assert.ok(!css.includes(banned), `Zakazany efekt w CSS: ${banned}`);
}

// The single contrast-registry invocation (grown by later tasks).
if (CONTRAST_REGISTRY_CALL) assertContrastRegistry(requiredContrasts);

if (!process.argv.includes("--artifact-only")) {
  assert.ok(existsSync(hubPath), `Brak huba: ${hubPath}`);
}

console.log("phase2_contract=passed");
