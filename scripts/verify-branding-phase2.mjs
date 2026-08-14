import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  "product-form", "states", "storefront", "form-measure", "secondary-domains",
  "secondary-emails", "secondary-delivery", "secondary-contracts", "secondary-team",
  "secondary-organization", "secondary-security", "secondary-site-editor",
  "orders-dark", "motion", "handoff", "secondary-out-of-scope",
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

// ===== Task 3: typography boundaries, spacing, marks =====
assert.doesNotMatch(html, /@font-face\s*\{[^}]*font-family:\s*"Geist Mono"/i);
assert.doesNotMatch(html, /font-family:\s*"Geist Mono"/i);
assert.match(css, /\[data-font-scope="product"\][\s\S]*?\[data-font-scope="product"\] \*[\s\S]*?\[data-font-scope="storefront"\][\s\S]*?\[data-font-scope="storefront"\] \*\s*\{[^}]*font-family:\s*"Geist Sans",\s*sans-serif/);
assert.match(html, /\.numeric-data\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
assert.match(html, /\[data-data-value\][^{]*\{[^}]*font-variant-numeric:\s*tabular-nums/);

const cssWithoutFontFaces = css.replace(/@font-face\s*\{[\s\S]*?\}/g, "");
for (const [, selector, body] of cssWithoutFontFaces.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const family = parseCssDeclarations(body).get("font-family");
  if (!family || !/(?:Safiro|Manrope)/.test(family)) continue;
  const normalizedSelector = selector.trim().replace(/\s+/g, " ");
  assert.ok(
    (family.includes("Safiro") && normalizedSelector === ".brand-copy") ||
    (family.includes("Manrope") && normalizedSelector === ".brand-support"),
    `Niedozwolona rodzina ${family} w selektorze ${normalizedSelector}`,
  );
}
for (const scope of findAll(tree, (node) => ["product", "storefront"].includes(node.attributes["data-font-scope"]))) {
  for (const descendant of findAll(scope, () => true)) {
    assert.doesNotMatch(descendant.attributes.class ?? "", /\b(?:brand-copy|brand-support)\b/);
    assert.doesNotMatch(descendant.attributes.style ?? "", /font-family\s*:\s*(?!"?Geist Sans)/i);
  }
}
assert.ok(findAll(tree, (node) => node.attributes["data-font-scope"] === "marketing").length > 0);

const requiredMarks = [
  "full-lime", "full-white", "full-canvas", "full-dark",
  "symbol-color", "symbol-mono", "symbol-negative",
  "favicon-16-light", "favicon-16-dark", "favicon-24-light", "favicon-24-dark",
  "grayscale",
];
for (const mark of requiredMarks) {
  assert.match(html, new RegExp(`data-brand-sign[^>]*data-brand-mark="${mark}"`));
  assert.match(html, new RegExp(`data-brand-mark="${mark}"`));
  assert.match(html, new RegExp(`data-svg-code="${mark}"`));
}

const approvedAPath = "M100.8 69.8588L116.599 20.2656H130.556L146.355 69.8588H138.774L135.303 58.8775H111.781L108.31 69.8588H100.8ZM113.907 52.0053H133.177L123.542 21.3992L113.907 52.0053Z";
const approvedLogoPaths = [
  "M280.703 69.8609L268.659 33.4453H276.31L287.434 68.7273L299.336 33.4453H307.2L289.063 84.7389H281.482L286.938 69.8609H280.703Z",
  "M258.992 69.8588V20.2656H266.077V69.8588H258.992Z",
  "M239.521 70.7799C231.302 70.7799 226.627 64.8287 225.422 56.7521V69.8588H218.337V20.2656H225.422V45.9833C226.627 37.6233 232.436 32.5222 239.521 32.5222C248.944 32.5222 255.461 40.528 255.461 51.7219C255.461 62.6324 248.802 70.7799 239.521 70.7799ZM225.139 51.7219C225.139 58.8066 229.815 64.3327 236.616 64.3327C243.205 64.3327 248.235 59.4443 248.235 51.7219C248.235 44.1412 243.205 38.9694 236.758 38.9694C230.381 38.9694 225.139 43.6453 225.139 51.7219Z",
  "M193.072 70.7811C185.775 70.7811 180.603 66.0343 180.603 59.2329C180.603 52.4316 185.633 48.4641 192.647 47.7556L205.045 46.4804C204.974 42.1587 201.857 38.758 196.402 38.758C191.372 38.758 188.963 41.9461 188.325 44.8509L182.02 43.0089C183.649 36.6326 188.892 32.5234 196.402 32.5234C207.029 32.5234 211.988 39.6082 211.988 46.9055V69.86H204.974V58.6662C204.974 66.3885 200.015 70.7811 193.072 70.7811ZM187.688 59.2329C187.688 62.7045 190.663 64.9007 194.56 64.9007C202.07 64.9007 205.045 59.4455 205.045 54.2736V52.2899L194.205 53.4234C189.884 53.9194 187.688 55.9031 187.688 59.2329Z",
  "M154.973 69.8609L143.071 33.4453H150.581L161.775 68.7982L172.543 33.4453H180.195L168.292 69.8609H154.973Z",
  approvedAPath,
];

const assertFrozenWordmarkGeometry = (source) => {
  assert.match(source, /^<svg\b[^>]*viewBox="0 0 348 93"[^>]*>[\s\S]*<\/svg>$/);
  assert.doesNotMatch(source, /<use\b|https?:\/\/|<script\b/);
  assert.match(source, /<rect[^>]*width="348"[^>]*height="93"[^>]*rx="44"[^>]*fill="#EAFFA4"/);
  assert.match(source, /<circle[^>]*cx="57\.5"[^>]*cy="46"[^>]*r="15"[^>]*fill="#A8C743"/);
  assert.match(source, /<g[^>]*transform="translate\(-2 0\)"/);
  assert.match(source, /transform="translate\(-2 0\)"[\s\S]*?<g[^>]*fill="#0B1017"/);
  assert.ok(source.indexOf("<rect") < source.indexOf("<circle"));
  assert.ok(source.indexOf("<circle") < source.indexOf('transform="translate(-2 0)"'));
  assert.deepEqual(
    [...source.matchAll(/<path\b[^>]*d="([^"]+)"/g)].map(([, path]) => path),
    approvedLogoPaths,
  );
};

const sourceNodes = findAll(tree, (node) => node.tag === "textarea" && "data-svg-code" in node.attributes);
assert.equal(sourceNodes.length, requiredMarks.length);
const svgSources = new Map(sourceNodes.map((node) => {
  assert.ok(node.attributes["aria-label"]);
  const source = decodeHtmlEntities(textContent(node)).trim();
  assert.match(source, /^<svg\b[\s\S]*<\/svg>$/);
  const sourceNetworkProbe = source.replaceAll("http://www.w3.org/2000/svg", "");
  assert.doesNotMatch(sourceNetworkProbe, /<use\b|https?:\/\/|<script\b|\b(?:href|src)="(?!#)/);
  return [node.attributes["data-svg-code"], source];
}));
assert.deepEqual([...svgSources.keys()], requiredMarks);

const approvedLogo = html.match(/<symbol id="avably-logo-approved" viewBox="0 0 348 93">([\s\S]*?)<\/symbol>/)?.[1] ?? "";
assertFrozenWordmarkGeometry(`<svg viewBox="0 0 348 93">${approvedLogo}</svg>`);
for (const variant of ["full-lime", "full-white", "full-canvas", "full-dark"]) {
  assertFrozenWordmarkGeometry(svgSources.get(variant));
}

for (const variant of ["symbol-color", "symbol-mono", "symbol-negative"]) {
  const source = svgSources.get(variant);
  assert.ok(source.includes(approvedAPath));
  assert.match(source, /<circle[^>]*data-brand-dot[^>]*cx="24"[^>]*cy="48"[^>]*r="10"/);
  assert.match(source, /transform="translate\(40 24\) scale\(\.96\) translate\(-100\.8 -20\.2656\)"/);
}
for (const variant of ["symbol-mono", "symbol-negative"]) {
  const paints = new Set(
    [...svgSources.get(variant).matchAll(/\b(?:fill|stroke)="([^"]+)"/g)]
      .map(([, paint]) => paint)
      .filter((paint) => paint !== "none"),
  );
  assert.equal(paints.size, 1, `${variant} musi używać jednej farby`);
}
for (const variant of ["favicon-16-light", "favicon-16-dark"]) {
  const source = svgSources.get(variant);
  assert.doesNotMatch(source, /<circle\b/);
  assert.ok(source.includes(approvedAPath));
}
for (const variant of ["favicon-24-light", "favicon-24-dark"]) {
  const source = svgSources.get(variant);
  assert.match(source, /<circle[^>]*data-brand-dot/);
  assert.ok(source.includes(approvedAPath));
}
assert.equal((html.match(/data-typography-step=/g) ?? []).length, 11);
assert.match(html, /data-clearspace="dot-diameter"/);
assert.match(html, /data-min-width="120"/);
const opening = findAll(tree, (node) => node.attributes["data-phase2-section"] === "opening");
assert.equal(opening.length, 1);
assert.equal(findAll(opening[0], (node) => "data-opening-logo" in node.attributes).length, 1);
assert.equal(findAll(opening[0], (node) => "data-opening-scope" in node.attributes).length, 1);
assert.equal(findAll(opening[0], (node) => "data-opening-carrier-rule" in node.attributes).length, 1);
const openingText = textContent(opening[0]).replace(/\s+/g, " ").trim();
for (const copy of [
  "Sygnał operacyjny w produkcie.",
  "Tokeny, znaki, panel, sklep i motion — gotowe do późniejszego wdrożenia.",
  "Limonka zawsze działa z widocznym nośnikiem.",
]) assert.ok(openingText.includes(copy));

// ===== Task 4: panel shell, dashboard, status matrix, order lists =====
const statusMap = {
  order: {
    pending: "attention",
    reserved: "neutral",
    ready_for_pickup: "attention",
    picked_up: "neutral",
    returned: "positive",
    cancelled: "problem",
  },
  payment: {
    unpaid: "attention",
    pending: "neutral",
    payment_failed: "problem",
    paid: "positive",
    manual: "attention",
    completed: "positive",
    deposit_refunded: "positive",
    refunded: "neutral",
    cancelled: "problem",
  },
  shipment: {
    created: "neutral",
    in_progress: "neutral",
    in_transit: "neutral",
    delivered: "positive",
    cancelled: "problem",
    returned_to_sender: "problem",
  },
};

Object.assign(requiredContrasts, {
  "dark-foreground-on-background": { foreground: "#F4F6F5", background: "#0B1017", minimum: 4.5, kind: "text" },
  "dark-foreground-on-card": { foreground: "#F4F6F5", background: "#111820", minimum: 4.5, kind: "text" },
  "dark-muted-on-secondary": { foreground: "#B8C0C5", background: "#1A232C", minimum: 4.5, kind: "text" },
  "dark-lime-on-accent": { foreground: "#EAFFA4", background: "#263016", minimum: 4.5, kind: "text" },
  "lime-on-dark-card": { foreground: "#EAFFA4", background: "#111820", minimum: 3, kind: "ui" },
  "border-on-dark-card": { foreground: "#7E8994", background: "#111820", minimum: 3, kind: "ui" },
  "status-light-neutral": { foreground: "#3F4A54", background: "#EDF0EE", minimum: 4.5, kind: "text" },
  "status-light-attention": { foreground: "#8A5A00", background: "#FFF3D6", minimum: 4.5, kind: "text" },
  "status-light-positive": { foreground: "#17643A", background: "#E6F6EC", minimum: 4.5, kind: "text" },
  "status-light-problem": { foreground: "#A93226", background: "#FCE9E6", minimum: 4.5, kind: "text" },
  "status-dark-neutral": { foreground: "#D5DADD", background: "#202A33", minimum: 4.5, kind: "text" },
  "status-dark-attention": { foreground: "#FFD37A", background: "#3A2C10", minimum: 4.5, kind: "text" },
  "status-dark-positive": { foreground: "#8DE0B0", background: "#133323", minimum: 4.5, kind: "text" },
  "status-dark-problem": { foreground: "#FFAEA4", background: "#3A1E1B", minimum: 4.5, kind: "text" },
  "status-dark-neutral-border": { foreground: "#7E8994", background: "#202A33", minimum: 3, kind: "ui" },
  "status-dark-attention-border": { foreground: "#D79A2B", background: "#3A2C10", minimum: 3, kind: "ui" },
  "status-dark-positive-border": { foreground: "#4FAE77", background: "#133323", minimum: 3, kind: "ui" },
  "status-dark-problem-border": { foreground: "#E06A5E", background: "#3A1E1B", minimum: 3, kind: "ui" },
  "chart-light-1": { foreground: "#0067A5", background: "#FFFFFF", minimum: 3, kind: "ui" },
  "chart-light-2": { foreground: "#A85C00", background: "#FFFFFF", minimum: 3, kind: "ui" },
  "chart-light-3": { foreground: "#007C6B", background: "#FFFFFF", minimum: 3, kind: "ui" },
  "chart-light-4": { foreground: "#7A5195", background: "#FFFFFF", minimum: 3, kind: "ui" },
  "chart-light-5": { foreground: "#B23A48", background: "#FFFFFF", minimum: 3, kind: "ui" },
  "chart-dark-1": { foreground: "#4DB4FF", background: "#111820", minimum: 3, kind: "ui" },
  "chart-dark-2": { foreground: "#FFB85C", background: "#111820", minimum: 3, kind: "ui" },
  "chart-dark-3": { foreground: "#43C9AD", background: "#111820", minimum: 3, kind: "ui" },
  "chart-dark-4": { foreground: "#C493E0", background: "#111820", minimum: 3, kind: "ui" },
  "chart-dark-5": { foreground: "#FF7F8C", background: "#111820", minimum: 3, kind: "ui" },
});

const statusMatrices = findAll(tree, (node) => "data-status-matrix" in node.attributes);
assert.equal(statusMatrices.length, 1, "Macierz statusów musi wystąpić dokładnie raz");
const expectedStatusTriples = Object.entries(statusMap).flatMap(([axis, values]) =>
  Object.entries(values).map(([value, tone]) => `${axis}/${value}/${tone}`),
);
const matrixChips = directChildren(
  statusMatrices[0],
  (node) => "data-status-axis" in node.attributes,
);
assert.equal(matrixChips.length, 21);
assert.deepEqual(
  matrixChips.map((chip) => [
    chip.attributes["data-status-axis"],
    chip.attributes["data-status-value"],
    chip.attributes["data-tone"],
  ].join("/")),
  expectedStatusTriples,
);
for (const chip of matrixChips) {
  assert.ok(textContent(chip).replace(/\s+/g, " ").trim(), "Chip statusu wymaga widocznego tekstu");
}
assert.deepEqual(
  Object.fromEntries(Object.keys(statusMap).map((axis) => [
    axis,
    matrixChips.filter((chip) => chip.attributes["data-status-axis"] === axis).length,
  ])),
  { order: 6, payment: 9, shipment: 6 },
);

const findOne = (predicate, message) => {
  const matches = findAll(tree, predicate);
  assert.equal(matches.length, 1, message);
  return matches[0];
};
const lightTable = findOne((node) => node.attributes["data-orders-table"] === "light", "Brak jednej jasnej tabeli");
const lightRowsBody = findOne(
  (node) => node.tag === "tbody" && node.attributes["data-orders-body"] === "light",
  "Brak jasnego tbody",
);
const lightRows = directChildren(lightRowsBody, (node) => node.tag === "tr" && "data-order-row" in node.attributes);
assert.equal(lightRows.length, 12, "Jasna lista musi mieć dokładnie 12 bezpośrednich wierszy demo");
const requiredCells = ["id", "customer", "equipment", "date", "amount", "order-status", "payment-status", "actions"];
for (const row of lightRows) {
  assert.match(row.attributes["data-order-id"], /^ZAM\/2026\/\d{4}$/);
  const cells = directChildren(row, (node) => node.tag === "td");
  assert.deepEqual(cells.map((cell) => cell.attributes["data-cell"]), requiredCells);
  for (const axis of ["order", "payment"]) {
    const chips = findAll(row, (node) => node.attributes["data-status-axis"] === axis);
    assert.equal(chips.length, 1, `${row.attributes["data-order-id"]}: oś ${axis}`);
    const code = chips[0].attributes["data-status-value"];
    assert.equal(chips[0].attributes["data-tone"], statusMap[axis][code]);
  }
  for (const cellName of ["id", "date", "amount"]) {
    const cell = cells.find((candidate) => candidate.attributes["data-cell"] === cellName);
    assert.ok(findAll(cell, (node) => "data-data-value" in node.attributes).length > 0);
  }
}

const darkTable = findOne((node) => node.attributes["data-orders-table"] === "dark", "Brak jednej ciemnej tabeli");
const darkRowsBody = findOne(
  (node) => node.tag === "tbody" && node.attributes["data-orders-body"] === "dark",
  "Brak ciemnego tbody",
);
const darkRows = directChildren(darkRowsBody, (node) => node.tag === "tr" && "data-order-row" in node.attributes);
assert.equal(darkRows.length, 12);
for (const row of darkRows) {
  const cells = directChildren(row, (node) => node.tag === "td");
  assert.deepEqual(cells.map((cell) => cell.attributes["data-cell"]), requiredCells);
  for (const cellName of ["id", "date", "amount"]) {
    const cell = cells.find((candidate) => candidate.attributes["data-cell"] === cellName);
    assert.ok(findAll(cell, (node) => "data-data-value" in node.attributes).length > 0);
  }
}
assert.deepEqual(
  darkRows.map((row) => row.attributes["data-order-id"]),
  lightRows.map((row) => row.attributes["data-order-id"]),
);
const rowSignature = (row) => ({
  id: row.attributes["data-order-id"],
  cells: directChildren(row, (node) => node.tag === "td").map((cell) => ({
    name: cell.attributes["data-cell"],
    text: textContent(cell).replace(/\s+/g, " ").trim(),
    statuses: findAll(cell, (node) => "data-status-axis" in node.attributes).map((chip) => ({
      axis: chip.attributes["data-status-axis"],
      value: chip.attributes["data-status-value"],
      tone: chip.attributes["data-tone"],
    })),
  })),
});
assert.deepEqual(darkRows.map(rowSignature), lightRows.map(rowSignature));
// Nawigacja panelu (ADR-183). INWENTARZ pozycji NIE jest tu zaszyty — jego
// właścicielem jest `apps/panel/test/panel-nav-contract.test.ts`, który parsuje
// TEN SAM `<nav data-panel-nav>` i porównuje go 1:1 z `PANEL_NAV_ITEMS`, czyli
// ze strukturą, z której renderuje się produkt (tam też stoi twarda liczność
// `{ placeholder: 1, item: 15, group: 3 }`). Lista zaszyta tutaj była TRZECIĄ
// kopią, nie miała czego pilnować i zardzewiała po czterech kolejnych
// pozycjach (`customers`, `legal`, `integrations`, `dataExport`).
//
// Zostaje to, czego tamten kontrakt nie dotyka, a co jest DECYZJĄ artefaktu:
// shell występuje w dwóch motywach i obie kopie muszą pokazywać to samo menu,
// dokładnie jedna pozycja jest bieżąca i jest nią `orders`, a zapowiedź
// dashboardu stoi poza grupami.
const panelNavs = findAll(tree, (node) => node.tag === "nav" && node.attributes["data-panel-nav"] === "true");
assert.ok(panelNavs.length >= 2, "Pokaż nawigację w jasnym i ciemnym shellu");
const navItemsOf = (nav) => directChildren(nav, (node) => "data-nav-item" in node.attributes);
const navItemIds = (nav) => navItemsOf(nav).map((node) => node.attributes["data-nav-item"]);
const referenceNavItemIds = navItemIds(panelNavs[0]);
// Podłoga po pustym zbiorze: bez niej porównanie kopii byłoby zielone na dwóch
// PUSTYCH tablicach, gdyby parser przestał widzieć pozycje. 11 to stan menu
// z dnia powstania artefaktu — to podłoga, a nie inwentarz: menu rośnie razem
// z produktem i wzrost nie ma prawa palić bramki designu.
assert.ok(
  referenceNavItemIds.length >= 11,
  `Nawigacja artefaktu ma ${referenceNavItemIds.length} pozycji — poniżej podłogi 11`,
);
assert.equal(
  new Set(referenceNavItemIds).size,
  referenceNavItemIds.length,
  "Identyfikatory pozycji nawigacji muszą być unikalne",
);
for (const nav of panelNavs) {
  const items = navItemsOf(nav);
  assert.deepEqual(
    navItemIds(nav),
    referenceNavItemIds,
    "Kopie shella (jasny/ciemny) pokazują różne menu",
  );
  for (const item of items) {
    assert.equal(item.tag, "a", "Pozycja nawigacji musi być linkiem");
    assert.ok(
      textContent(item).replace(/\s+/g, " ").trim(),
      `Pozycja ${item.attributes["data-nav-item"]} bez widocznej etykiety`,
    );
  }
  assert.equal(directChildren(nav, (node) => node.attributes["data-nav-placeholder"] === "dashboard").length, 1);
  assert.equal(items.filter((node) => node.attributes["aria-current"] === "page").length, 1);
  assert.equal(items.find((node) => node.attributes["aria-current"] === "page").attributes["data-nav-item"], "orders");
}
const activeNavRules = [...css.matchAll(/(?:\.dark\s+)?\.sidebar-nav\s+\[aria-current="page"\]\s*\{([^}]*)\}/g)];
assert.equal(activeNavRules.length, 2);
for (const [, declarations] of activeNavRules) {
  assert.doesNotMatch(declarations, /border-(?:left|inline-start)/);
}

const dashboard = findOne(
  (node) => node.attributes["data-screen"] === "dashboard-placeholder",
  "Brak jednego placeholdera dashboardu",
);
const dashboardSource = html.slice(dashboard.start, dashboard.end);
const dashboardText = textContent(dashboard).replace(/\s+/g, " ").trim();
assert.match(dashboardSource, /Tu będzie centrum dowodzenia\./);
assert.match(dashboardSource, /Dashboard czeka na dane\. Do tego czasu najwięcej dzieje się w zamówieniach\./);
assert.match(dashboardSource, />Przejdź do zamówień</);
assert.equal(dashboard.attributes["data-no-backend"], "true");
assert.doesNotMatch(dashboardText, /\d|\bzł\b|trend|przychód|konwersj|rezerwacj[ei] dziś|zamówień dziś|średnia|obrót|wzrost|spadek|KPI/i);
assert.deepEqual(
  findAll(dashboard, (node) => "data-chart-placeholder" in node.attributes)
    .map((node) => [node.attributes["data-chart-placeholder"], node.attributes["data-example"]]),
  [["line", "true"], ["bars", "true"]],
);

const chartContracts = {
  light: ["#0067A5", "#A85C00", "#007C6B", "#7A5195", "#B23A48"],
  dark: ["#4DB4FF", "#FFB85C", "#43C9AD", "#C493E0", "#FF7F8C"],
};
const chartDashes = ["solid", "8 4", "2 3", "12 3 2 3", "1 4"];
const chartMarkers = ["circle", "square", "triangle", "diamond", "cross"];
for (const [theme, colors] of Object.entries(chartContracts)) {
  const chart = findOne(
    (node) => node.attributes["data-chart-system"] === theme,
    `Brak jednego przykładowego wykresu ${theme}`,
  );
  assert.equal(chart.attributes["data-example"], "true");
  const series = directChildren(chart, (node) => "data-chart-series" in node.attributes);
  assert.deepEqual(series.map((node) => node.attributes["data-chart-series"]), ["1", "2", "3", "4", "5"]);
  assert.deepEqual(series.map((node) => node.attributes["data-color"]), colors);
  assert.deepEqual(series.map((node) => node.attributes["data-dash"]), chartDashes);
  assert.deepEqual(series.map((node) => node.attributes["data-marker"]), chartMarkers);
  assert.deepEqual(series.map((node) => node.attributes["data-contrast-ref"]), colors.map((_, index) => `chart-${theme}-${index + 1}`));
}

// ===== Task 5: order detail, form states, buttons, errors =====
const detail = html.match(/<article\b[^>]*data-screen="order-detail"[^>]*>([\s\S]*?)<\/article>/)?.[1] ?? "";
for (const copy of ["ZAM/2026/0716", "KAUCJA", "STATUS PŁATNOŚCI", "1 200,00 zł", "Płatność ręczna"]) {
  assert.ok(detail.includes(copy), `Brak w detalu: ${copy}`);
}
assert.ok((detail.match(/data-label-value/g) ?? []).length >= 8);
assert.match(detail, /data-status-axis="shipment" data-status-value="created"/);
for (const group of ["customer", "items", "history", "payment", "deposit", "delivery", "actions"]) {
  assert.match(detail, new RegExp(`data-detail-group="${group}"`));
}

const form = html.match(/<form\b[^>]*data-product-form[^>]*>([\s\S]*?)<\/form>/)?.[1] ?? "";
for (const field of ["name", "sku", "category", "quantity", "daily-price", "deposit"]) {
  assert.match(form, new RegExp(`name="${field}"`));
}
assert.match(form, /aria-invalid="true"/);
assert.match(form, /aria-describedby="product-name-error"/);
assert.match(form, /id="product-name-error"[^>]*role="alert"[^>]*>Nazwa musi mieć co najmniej 3 znaki\./);
assert.match(form, /data-state="focus"/);

Object.assign(requiredContrasts, {
  "ink-on-secondary": { foreground: "#0B1017", background: "#E7EBE8", minimum: 4.5, kind: "text" },
  "white-on-destructive": { foreground: "#FFFFFF", background: "#A93226", minimum: 4.5, kind: "text" },
  "dark-foreground-on-secondary": { foreground: "#F4F6F5", background: "#1A232C", minimum: 4.5, kind: "text" },
  "ink-on-dark-destructive": { foreground: "#0B1017", background: "#FF8A7A", minimum: 4.5, kind: "text" },
  "error-border-on-canvas": { foreground: "#A93226", background: "#F4F6F5", minimum: 3, kind: "ui" },
});

const componentStates = {
  "button-primary": ["default", "hover", "focus", "active", "disabled", "loading"],
  "button-secondary": ["default", "hover", "focus", "active", "disabled", "loading"],
  "button-destructive": ["default", "hover", "focus", "active", "disabled", "loading"],
  input: ["default", "hover", "focus", "active", "disabled", "loading", "error", "valid"],
  filter: ["default", "hover", "focus", "active", "disabled", "loading"],
  row: ["default", "hover", "focus", "active"],
};
const refsFor = (states, value) => Object.fromEntries(states.map((state) => [state, value]));
const componentStateContrastRefs = {
  "button-primary": refsFor(componentStates["button-primary"], "white-on-ink"),
  "button-secondary": refsFor(componentStates["button-secondary"], "ink-on-secondary"),
  "button-destructive": refsFor(componentStates["button-destructive"], "white-on-destructive"),
  input: {
    default: "ink-on-canvas border-on-canvas", hover: "ink-on-canvas border-on-canvas",
    focus: "ink-on-canvas", active: "ink-on-canvas border-on-canvas",
    disabled: "ink-on-canvas border-on-canvas", loading: "ink-on-canvas border-on-canvas",
    error: "ink-on-canvas error-border-on-canvas", valid: "ink-on-canvas border-on-canvas",
  },
  filter: {
    default: "ink-on-secondary", hover: "ink-on-secondary", focus: "ink-on-secondary",
    active: "ink-on-lime", disabled: "ink-on-secondary", loading: "ink-on-secondary",
  },
  row: {
    default: "ink-on-white", hover: "ink-on-white", focus: "ink-on-white",
    active: "ink-on-white signal-on-white",
  },
};
for (const [component, states] of Object.entries(componentStates)) {
  const gallery = findOne(
    (node) => node.attributes["data-component"] === component,
    `Brak jednej galerii ${component}`,
  );
  const stateNodes = directChildren(gallery, (node) => "data-state" in node.attributes);
  assert.deepEqual(stateNodes.map((node) => node.attributes["data-state"]), states);
  const disabledState = stateNodes.find((node) => node.attributes["data-state"] === "disabled");
  if (disabledState) assert.ok("disabled" in disabledState.attributes || disabledState.attributes["aria-disabled"] === "true");
  const loadingState = stateNodes.find((node) => node.attributes["data-state"] === "loading");
  if (loadingState) assert.equal(loadingState.attributes["aria-busy"], "true");
  for (const stateNode of stateNodes) {
    const state = stateNode.attributes["data-state"];
    const expectedRefs = componentStateContrastRefs[component][state];
    assert.equal(stateNode.attributes["data-contrast-ref"].trim().replace(/\s+/g, " "), expectedRefs, `${component}/${state}: błędna para kontrastu`);
    const pairs = expectedRefs.split(/\s+/).map((id) => requiredContrasts[id]);
    const textPairs = pairs.filter((pair) => pair.kind === "text");
    const uiPairs = pairs.filter((pair) => pair.kind === "ui");
    assert.equal(textPairs.length, 1, `${component}/${state}: wymagaj jednej pary tekstowej`);
    assert.ok(uiPairs.length <= 1, `${component}/${state}: najwyżej jedna para obrysu`);
    const statePaint = parseCssDeclarations(stateNode.attributes.style ?? "");
    assert.equal(statePaint.get("--state-foreground"), textPairs[0].foreground, `${component}/${state}: realny foreground`);
    assert.equal(statePaint.get("--state-background"), textPairs[0].background, `${component}/${state}: realne background`);
    if (uiPairs[0]) {
      assert.equal(statePaint.get("--state-border"), uiPairs[0].foreground, `${component}/${state}: realny border`);
      assert.equal(uiPairs[0].background, textPairs[0].background, `${component}/${state}: border/background mismatch`);
    }
  }
}
const statePaintRule = parseCssDeclarations(extractBalancedCssBody(css, '[data-component] > [data-state]'));
assert.equal(statePaintRule.get("color"), "var(--state-foreground)");
assert.equal(statePaintRule.get("background"), "var(--state-background)");
assert.match(statePaintRule.get("border-color") ?? "", /var\(--state-border,\s*currentColor\)/);

for (const { selector, declarations } of cssRuleBlocks) {
  const paints = [...declarations.keys()].filter((property) => /^(?:color|background(?:-color)?)$/i.test(property));
  if (!paints.length) continue;
  const normalized = selector.trim().replace(/\s+/g, " ");
  if (/:(?:hover|active|disabled)\b|\[aria-(?:disabled|busy)=/.test(normalized)) {
    assert.fail(`Pseudo-stan nie może obchodzić --state paint: ${normalized}`);
  }
  if (/\[data-state=/.test(normalized)) {
    assert.equal(normalized, '[data-component="filter"] [data-state="active"]', `Stan z własnym paintem poza kontraktem: ${normalized}`);
  }
}
const validState = findOne((node) => node.attributes["data-state"] === "valid", "Brak jednego valid input");
assert.doesNotMatch(html.slice(validState.start, validState.end), /green|zielon|success-dot|data-brand-dot/);
const errorState = findOne((node) => node.attributes["data-state"] === "error", "Brak jednego error input");
assert.equal(findAll(errorState, (node) => "data-error-icon" in node.attributes).length, 1);
assert.equal(findAll(errorState, (node) => node.attributes.role === "alert").length, 1);

const focusRule = parseCssDeclarations(extractBalancedCssBody(css, ":focus-visible"));
assert.equal(focusRule.get("border"), "2px solid var(--foreground)");
assert.equal(focusRule.get("outline"), "3px solid var(--accent)");
assert.equal(focusRule.get("outline-offset"), "2px");
const activeFilterRule = parseCssDeclarations(extractBalancedCssBody(css, '[data-component="filter"] [data-state="active"]'));
assert.equal(activeFilterRule.get("background"), "var(--accent)");
assert.equal(activeFilterRule.get("color"), "var(--accent-foreground)");
assert.equal(activeFilterRule.get("border"), "1px solid var(--foreground)");
const lightSelectedRule = parseCssDeclarations(extractBalancedCssBody(css, '[data-component="row"] [data-state="active"]'));
assert.equal(lightSelectedRule.get("border-left"), "2px solid var(--signal-strong)");
const darkSelectedRule = parseCssDeclarations(extractBalancedCssBody(css, '.dark [data-component="row"] [data-state="active"]'));
assert.equal(darkSelectedRule.get("border-left"), "2px solid var(--accent-foreground)");
const componentPairRules = {
  ".button-primary": { background: "var(--primary)", color: "var(--primary-foreground)" },
  ".button-secondary": { background: "var(--secondary)", color: "var(--secondary-foreground)", border: "1px solid var(--foreground)" },
  ".button-destructive": { background: "var(--destructive)", color: "var(--destructive-foreground)" },
  ".dark .button-primary": { background: "var(--primary)", color: "var(--primary-foreground)" },
  ".dark .button-secondary": { background: "var(--secondary)", color: "var(--secondary-foreground)", border: "1px solid var(--foreground)" },
  ".dark .button-destructive": { background: "var(--destructive)", color: "var(--destructive-foreground)" },
  '[aria-invalid="true"]': { background: "var(--background)", border: "1px solid var(--destructive)" },
};
for (const [selector, declarations] of Object.entries(componentPairRules)) {
  const actual = parseCssDeclarations(extractBalancedCssBody(css, selector));
  for (const [property, value] of Object.entries(declarations)) assert.equal(actual.get(property), value, `${selector} ${property}`);
}

const resolveCssPaint = (declaration, themeTokens) => {
  const variable = declaration?.match(/var\(--([\w-]+)\)/)?.[1];
  if (variable) {
    assert.ok(themeTokens[variable], `Brak HEX dla --${variable}`);
    return themeTokens[variable];
  }
  const literal = declaration?.match(/#[0-9A-F]{6}/i)?.[0].toUpperCase();
  assert.ok(literal, `Nie można rozwiązać paintu: ${declaration}`);
  return literal;
};
const lightPaintTokens = { ...lightTokens, "signal-strong": "#5F7500" };
const cssContrastContracts = [
  { selector: ".button-primary", theme: lightPaintTokens, foreground: "color", background: "background", ref: "white-on-ink" },
  { selector: ".button-secondary", theme: lightPaintTokens, foreground: "color", background: "background", ref: "ink-on-secondary" },
  { selector: ".button-destructive", theme: lightPaintTokens, foreground: "color", background: "background", ref: "white-on-destructive" },
  { selector: ".dark .button-primary", theme: darkTokens, foreground: "color", background: "background", ref: "ink-on-lime" },
  { selector: ".dark .button-secondary", theme: darkTokens, foreground: "color", background: "background", ref: "dark-foreground-on-secondary" },
  { selector: ".dark .button-destructive", theme: darkTokens, foreground: "color", background: "background", ref: "ink-on-dark-destructive" },
  { selector: '[aria-invalid="true"]', theme: lightPaintTokens, foreground: "border", background: "background", ref: "error-border-on-canvas" },
  { selector: '[data-component="filter"] [data-state="active"]', theme: lightPaintTokens, foreground: "color", background: "background", ref: "ink-on-lime" },
  { selector: ':focus-visible', theme: lightPaintTokens, foreground: "border", backgroundHex: "#F4F6F5", ref: "ink-on-canvas" },
  { selector: '[data-component="row"] [data-state="active"]', theme: lightPaintTokens, foreground: "border-left", backgroundHex: "#FFFFFF", ref: "signal-on-white" },
  { selector: '.dark [data-component="row"] [data-state="active"]', theme: darkTokens, foreground: "border-left", backgroundHex: "#111820", ref: "lime-on-dark-card" },
];
for (const contract of cssContrastContracts) {
  const declarations = parseCssDeclarations(extractBalancedCssBody(css, contract.selector));
  const foreground = resolveCssPaint(declarations.get(contract.foreground), contract.theme);
  const background = contract.backgroundHex ?? resolveCssPaint(declarations.get(contract.background), contract.theme);
  assert.equal(foreground, requiredContrasts[contract.ref].foreground, `${contract.selector}: foreground/ref mismatch`);
  assert.equal(background, requiredContrasts[contract.ref].background, `${contract.selector}: background/ref mismatch`);
}

// ===== Task 6: storefront boundary, loading, empty, 404 =====
const store = html.match(/<article\b[^>]*data-screen="storefront"[^>]*>([\s\S]*?)<\/article>/)?.[1] ?? "";
assert.match(store, /class="[^"]*store-preview/);
assert.doesNotMatch(store, /brand-copy|brand-support|Safiro|Manrope/);
assert.doesNotMatch(store, /data-panel-nav|sidebar-nav/);
assert.match(store, /Sprzęt na termin, którego potrzebujesz\./);

const empty = html.match(/<article\b[^>]*data-screen="empty"[^>]*>([\s\S]*?)<\/article>/)?.[1] ?? "";
assert.match(empty, /Podejrzanie spokojnie\. Dodaj pierwsze zamówienie\./);
assert.match(empty, /data-delight="empty"/);
assert.match(empty, />Dodaj zamówienie</);

const notFound = html.match(/<article\b[^>]*data-screen="not-found"[^>]*>([\s\S]*?)<\/article>/)?.[1] ?? "";
assert.match(notFound, /Ta strona wyjechała bez protokołu wydania\./);
assert.match(notFound, /data-delight="not-found"/);
assert.match(notFound, />Wróć do zamówień</);

const loadingNode = findOne((node) => node.attributes["data-screen"] === "loading", "Brak loading screen");
assert.equal(loadingNode.attributes["aria-busy"], "true");
const skeletonRows = directChildren(loadingNode, (node) => "data-skeleton-row" in node.attributes);
assert.equal(skeletonRows.length, 2);
for (const row of skeletonRows) {
  const cells = directChildren(row, (node) => "data-skeleton-cell" in node.attributes);
  assert.deepEqual(cells.map((cell) => cell.attributes["data-cell"]), requiredCells);
}

// ===== Task 7: motion system, landing, social, reduced-motion =====
for (const token of [
  "--motion-fast: 160ms", "--motion-ui: 240ms", "--motion-confirm: 480ms",
  "--motion-reveal: 720ms", "--motion-delight: 1200ms", "--motion-logo: 6000ms",
  "--motion-ad: 8000ms", "--motion-ambient: 16000ms",
]) assert.ok(css.includes(token), `Brak ${token} w aktywnym CSS`);

const motionDemoContract = {
  logo: { loop: "none" },
  ui: { loop: "none" },
  dashboard: { loop: "none" },
  landing: { loop: "none" },
  "ad-square": { loop: "ad", format: "1:1" },
  "ad-portrait": { loop: "ad", format: "4:5" },
  empty: { loop: "none" },
  "not-found": { loop: "none" },
};
for (const [demo, contract] of Object.entries(motionDemoContract)) {
  const nodes = findAll(tree, (node) => node.attributes["data-motion-demo"] === demo);
  assert.equal(nodes.length, 1, `Demo ${demo} musi wystąpić raz`);
  assert.equal(nodes[0].attributes["data-loop"], contract.loop);
  assert.equal(nodes[0].attributes["data-motion-final"], "true");
  if (contract.format) assert.equal(nodes[0].attributes["data-format"], contract.format);
}

const infiniteRules = [...css.matchAll(/([^{}]+)\{([^{}]*animation[^{}]*\binfinite\b[^{}]*)\}/g)]
  .map(([, selector]) => selector.trim().replace(/\s+/g, " "));
assert.deepEqual(infiniteRules.sort(), ['[data-loop="ad"]', '[data-loop="rail"]'].sort());
assert.match(parseCssDeclarations(extractBalancedCssBody(css, '[data-loop="rail"]')).get("animation") ?? "", /var\(--motion-ambient\)[\s\S]*infinite/);
assert.match(parseCssDeclarations(extractBalancedCssBody(css, '[data-loop="ad"]')).get("animation") ?? "", /var\(--motion-ad\)[\s\S]*infinite/);
const motionLoops = findAll(tree, (node) => ["rail", "ad"].includes(node.attributes["data-loop"]));
assert.equal(motionLoops.filter((node) => node.attributes["data-loop"] === "rail").length, 1);
assert.equal(motionLoops.filter((node) => node.attributes["data-loop"] === "ad").length, 2);
for (const loop of motionLoops) {
  assert.match(loop.attributes.class ?? "", /\bmotion-loop\b/);
  assert.equal(loop.attributes.tabindex, "0");
}
assert.match(css, /\.motion-loop:hover(?:,|[^}])*animation-play-state:\s*paused/);
assert.match(css, /\.motion-loop:focus-within(?:,|[^}])*animation-play-state:\s*paused/);

const oneShotDurations = {
  logo: "var(--motion-logo)",
  ui: "var(--motion-confirm)",
  dashboard: "var(--motion-delight)",
  landing: "var(--motion-reveal)",
  empty: "var(--motion-delight)",
  "not-found": "var(--motion-delight)",
};
for (const [demo, duration] of Object.entries(oneShotDurations)) {
  const node = findOne((candidate) => candidate.attributes["data-motion-demo"] === demo, `Brak jednego demo ${demo}`);
  assert.equal(node.attributes["data-loop"], "none");
  assert.equal(node.attributes["data-motion-final"], "true");
  const rule = parseCssDeclarations(extractBalancedCssBody(css, `[data-motion-demo="${demo}"][data-loop="none"]`));
  assert.match(rule.get("animation") ?? "", new RegExp(`${duration.replace(/[()\-]/g, "\\$&")}[\\s\\S]*\\b1\\b`));
}

const parseKeyframes = (name) => {
  const body = extractBalancedCssBody(css, `@keyframes ${name}`);
  assert.ok(body, `Brak @keyframes ${name}`);
  return [...body.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, selectors, declarations]) =>
    selectors.split(",").map((selector) => ({
      percent: selector.trim() === "from" ? 0 : selector.trim() === "to" ? 100 : Number.parseFloat(selector),
      declarations: Object.fromEntries(parseCssDeclarations(declarations)),
    })),
  ).sort((left, right) => left.percent - right.percent);
};

const allowedMotionProperties = new Set(["opacity", "transform", "clip-path"]);
for (const name of ["operational-rail", "ad-sequence", "one-shot-delight"]) {
  for (const frame of parseKeyframes(name)) {
    for (const property of Object.keys(frame.declarations)) assert.ok(allowedMotionProperties.has(property), `${name}: ${property}`);
  }
}

const assertStaticKeyframeInterval = (name, start, end) => {
  const frames = parseKeyframes(name).filter((frame) => frame.percent >= start && frame.percent <= end);
  assert.equal(frames[0].percent, start);
  assert.equal(frames.at(-1).percent, end);
  for (const frame of frames.slice(1)) assert.deepEqual(frame.declarations, frames[0].declarations);
};
assertStaticKeyframeInterval("ad-sequence", 72, 92);

const railPrimary = findOne((node) => "data-rail-primary" in node.attributes, "Brak głównego zestawu raila");
assert.equal(directChildren(railPrimary, (node) => "data-rail-cell" in node.attributes).length, 6);
assert.equal(findAll(tree, (node) => node.attributes["data-rail-duplicate"] === "true").length, 1);

const reduced = extractBalancedCssBody(css, "@media (prefers-reduced-motion: reduce)");
assert.match(reduced, /animation:\s*none\s*!important/);
assert.match(reduced, /transition:\s*none\s*!important/);
assert.match(reduced, /clip-path:\s*none\s*!important/);
assert.match(reduced, /\[data-motion-final\][^}]*opacity:\s*1\s*!important[^}]*transform:\s*none\s*!important/);
assert.match(reduced, /\[data-loop="rail"\][^}]*transform:\s*none\s*!important[^}]*width:\s*100%[^}]*min-width:\s*0[^}]*overflow:\s*visible/);
assert.match(reduced, /\[data-rail-primary\][^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)[^}]*white-space:\s*normal/);
assert.match(reduced, /\[data-rail-cell\][^}]*min-width:\s*0[^}]*overflow-wrap:\s*anywhere/);
assert.match(reduced, /\[data-rail-duplicate="true"\][^}]*display:\s*none\s*!important/);
assert.doesNotMatch(reduced, /shimmer|background-position/);

// ===== Task 8: handoff, hard rules, hub, structure =====
assert.match(html, /data-phase2-section="handoff"/);

const hardDontCopy = {
  "lime-without-carrier": "Limonka nie oznacza stanu na bieli lub canvas bez ink carrier albo signal-strong.",
  "dot-as-ui": "Kropka #A8C743 nie występuje poza zatwierdzonym znakiem marki.",
  "wrong-product-font": "Panel i sklep nie używają Geist Mono, Safiro ani Manrope — tylko Geist Sans.",
  effects: "Bez gradientów, szkła, blur, cieni unoszących karty i ilustracji 3D.",
  "color-only-status": "Status zawsze zawiera tekst konkretnej wartości, nie sam kolor lub ikonę.",
  "fake-dashboard": "Placeholder dashboardu nie pokazuje KPI, trendów ani procentów bez backendu.",
  "extra-loops": "Poza rail LP i reklamą nie ma nieskończonych animacji.",
};
const hardDontNodes = findAll(tree, (node) => "data-hard-dont" in node.attributes);
assert.deepEqual(hardDontNodes.map((node) => node.attributes["data-hard-dont"]), Object.keys(hardDontCopy));
for (const node of hardDontNodes) {
  assert.equal(textContent(node).replace(/\s+/g, " ").trim(), hardDontCopy[node.attributes["data-hard-dont"]]);
}

const codeSurfaceNames = [
  "form-measure", "secondary-status-map", "tokens-light", "tokens-dark", "svg-set",
  "status-map", "motion-tokens",
];
const codeSurfaceNodes = findAll(tree, (node) => "data-code-surface" in node.attributes);
assert.deepEqual(codeSurfaceNodes.map((node) => node.attributes["data-code-surface"]), codeSurfaceNames);
const codeSurfaceText = (name) => {
  const matches = codeSurfaceNodes.filter((node) => node.attributes["data-code-surface"] === name);
  assert.equal(matches.length, 1, `Powierzchnia kodu ${name} musi wystąpić raz`);
  const value = decodeHtmlEntities(textContent(matches[0])).trim();
  assert.ok(value.length > 0, `Powierzchnia kodu ${name} nie może być pusta`);
  return value;
};
const expectedFormMeasureSurface = [
  '[data-brand-system="avably-phase-2"] { --form-line-measure: 42rem; }',
  '[data-form-line-measure] { width: 100%; max-width: var(--form-line-measure); }',
].join("\n");
assert.equal(codeSurfaceText("form-measure"), expectedFormMeasureSurface);
assert.match(css, /\[data-brand-system="avably-phase-2"\]\s*\{\s*--form-line-measure:\s*42rem;\s*\}/);
assert.match(css, /\[data-form-line-measure\]\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*var\(--form-line-measure\);[^}]*\}/);

// Mapa statusów drugorzędnych (ADR-183). Źródłem jest POWIERZCHNIA HANDOFFU
// artefaktu — kopia zaszyta tu wcześniej była TRZECIĄ (po produkcie:
// `apps/panel/lib/secondary-status.tsx`, pilnowanym 1:1 przez
// `apps/panel/test/secondary-status-contract.test.ts`) i zardzewiała o całą oś
// `delivery-section` oraz cztery wartości dołożone do osi istniejących.
//
// Wyprowadzenie NIE jest wolne od treści: mapa wraca niżej jako oczekiwanie dla
// KAŻDEGO chipa w mockupach (oś, wartość, ton, klasa) i w drugą stronę — każdy
// wpis mapy musi wystąpić w mockupie. To jest realny dowód, bo obie strony
// porównania są zapisane w artefakcie niezależnie od siebie.
const secondaryStatusMap = JSON.parse(codeSurfaceText("secondary-status-map"));
// KSZTAŁT zostaje zaszyty, bo to decyzja, której artefakt nie może o sobie
// orzec: słownik tonów jest ZAMKNIĘTY. Wykaz tonów bierzemy z kontraktu
// kontrastu wyżej (`status-light-<ton>`), więc nowy ton bez udowodnionej pary
// kontrastu jest z definicji nielegalny — i nie powstaje przy tym kolejna
// lista do pamiętania.
const allowedTones = Object.keys(requiredContrasts)
  .map((name) => name.match(/^status-light-(\w+)$/)?.[1])
  .filter(Boolean);
assert.ok(allowedTones.length >= 4, "Kontrakt kontrastu nie oddał słownika tonów");
// Podłoga po pustym zbiorze: `JSON.parse("{}")` przeszedłby każdą pętlę niżej.
assert.ok(
  Object.keys(secondaryStatusMap).length >= 13,
  `Mapa statusów drugorzędnych ma ${Object.keys(secondaryStatusMap).length} osi — poniżej podłogi 13`,
);
for (const [axis, values] of Object.entries(secondaryStatusMap)) {
  assert.match(axis, /^[a-z][a-z-]*$/, `Nazwa osi spoza konwencji: ${axis}`);
  assert.ok(Object.keys(values).length >= 1, `Oś ${axis} bez wartości`);
  for (const [value, tone] of Object.entries(values)) {
    assert.match(value, /^[a-z][a-z_]*$/, `Wartość spoza konwencji: ${axis}.${value}`);
    assert.ok(
      allowedTones.includes(tone),
      `${axis}.${value}: ton "${tone}" spoza słownika (${allowedTones.join(", ")})`,
    );
  }
}
const activeTokenCopy = (theme) => {
  const matches = findAll(tree, (node) => node.attributes["data-token-code"] === theme);
  assert.equal(matches.length, 1, `Brak jednej aktywnej kopii tokenów ${theme}`);
  return decodeHtmlEntities(textContent(matches[0])).trim();
};
const activeThemeSource = (selector) => `${selector} {\n${extractBalancedCssBody(css, selector).trim()}\n}`;
assert.equal(activeTokenCopy("light"), activeThemeSource(":root"));
assert.equal(activeTokenCopy("dark"), activeThemeSource(".dark"));
assert.equal(codeSurfaceText("tokens-light"), activeTokenCopy("light"));
assert.equal(codeSurfaceText("tokens-dark"), activeTokenCopy("dark"));
const expectedSvgSet = requiredMarks
  .map((name) => `### ${name}\n${svgSources.get(name)}`)
  .join("\n\n");
assert.equal(codeSurfaceText("svg-set"), expectedSvgSet);
assert.equal(codeSurfaceText("status-map"), JSON.stringify(statusMap, null, 2));
const expectedMotionTokens = [
  "--motion-fast: 160ms;", "--motion-ui: 240ms;", "--motion-confirm: 480ms;",
  "--motion-reveal: 720ms;", "--motion-delight: 1200ms;", "--motion-logo: 6000ms;",
  "--motion-ad: 8000ms;", "--motion-ambient: 16000ms;",
].join("\n");
const activeMotionDeclarations = parseCssDeclarations(extractBalancedCssBody(css, ":root"));
for (const declaration of expectedMotionTokens.split("\n")) {
  const [name, expectedValue] = declaration.replace(/;$/, "").split(/:\s*/, 2);
  assert.equal(activeMotionDeclarations.get(name), expectedValue, `Aktywny ${name} różni się od handoffu`);
}
assert.equal(codeSurfaceText("motion-tokens"), expectedMotionTokens);

const requiredScreens = [
  "dashboard-placeholder", "orders-light", "order-detail", "product-form",
  "system-states", "storefront", "loading", "empty", "not-found", "orders-dark",
  "landing-motion", "social-ad-square", "social-ad-portrait", "secondary-domains",
  "secondary-email-settings", "secondary-email-history", "secondary-delivery",
  "secondary-contracts", "secondary-team", "secondary-organization",
  "secondary-security", "secondary-site-editor",
];
for (const screen of requiredScreens) {
  const nodes = findAll(tree, (node) => node.attributes["data-screen"] === screen);
  assert.equal(nodes.length, 1, `Ekran ${screen} musi wystąpić dokładnie raz`);
  const expectedScope = screen === "storefront"
    ? "storefront"
    : ["landing-motion", "social-ad-square", "social-ad-portrait"].includes(screen)
      ? "marketing"
      : "product";
  assert.equal(nodes[0].attributes["data-font-scope"], expectedScope);
}

const secondaryScreenNames = requiredScreens.filter((name) => name.startsWith("secondary-"));
for (const screen of secondaryScreenNames) {
  const node = findAll(tree, (candidate) => candidate.attributes["data-screen"] === screen)[0];
  assert.equal(node.attributes["data-demo-data"], "fictional", `${screen}: dane demo muszą być jawnie fikcyjne`);
  assert.ok(
    findAll(node, (candidate) => "data-form-line-measure" in candidate.attributes).length > 0,
    `${screen}: brak wspólnej miary formularza`,
  );
}

// Akcje ekranów drugorzędnych (ADR-183). To ZBIÓR WYMAGANY, nie inwentarz:
// każda wymieniona akcja musi w mockupie być, ale akcja DOŁOŻONA nie pali
// bramki. Równość mieliśmy wcześniej i to ona zardzewiała — `restore-section`
// (K5a, ADR-091) doszedł do edytora strony legalnie, razem z sekcją usuniętą
// w szkicu, a bramka designu nazwała to „rozjazdem".
//
// Kierunek pilnowania jest asymetryczny CELOWO: mockup, który GUBI nogę
// (regres z PR #313), musi zapalić czerwień, bo dokumentacja zaczyna wtedy
// pokazywać ekran, którego produkt nie ma. Mockup, który dostaje nową nogę,
// nadąża za produktem i nie jest awarią designu.
const requiredActions = {
  "secondary-domains": ["back-to-panel", "retry-registration", "check-domain", "remove-domain", "add-domain"],
  "secondary-email-settings": ["back-to-panel", "save-email-sender"],
  "secondary-email-history": ["filter-email-history", "order-link", "previous-page", "next-page"],
  "secondary-delivery": ["back-to-orders", "save-credentials", "save-sender", "save-parcel", "save-pricing"],
  "secondary-contracts": ["save-contract-settings"],
  "secondary-team": ["invite-member"],
  "secondary-organization": [],
  "secondary-security": ["enroll-totp", "verify-totp", "challenge-totp"],
  "secondary-site-editor": [
    "back-to-panel", "publish-site", "update-template", "add-section", "move-up",
    "move-down", "toggle-section", "delete-section", "save-section", "faq-remove", "faq-add",
  ],
};
for (const [screen, required] of Object.entries(requiredActions)) {
  const node = findAll(tree, (candidate) => candidate.attributes["data-screen"] === screen)[0];
  const carriers = findAll(node, (candidate) => "data-action" in candidate.attributes);
  const actual = [...new Set(carriers.map((candidate) => candidate.attributes["data-action"]))];
  const missing = required.filter((action) => !actual.includes(action));
  assert.deepEqual(missing, [], `${screen}: mockup zgubił akcje`);
  // Każda akcja — także dołożona po tej liście — musi być NOŚNIKIEM decyzji,
  // a nie samym atrybutem: klikalna kontrolka z widoczną etykietą.
  for (const carrier of carriers) {
    const action = carrier.attributes["data-action"];
    assert.match(action, /^[a-z][a-z0-9-]*$/, `${screen}: akcja spoza konwencji: ${action}`);
    assert.ok(
      ["button", "a"].includes(carrier.tag),
      `${screen}: akcja ${action} na <${carrier.tag}>, nie na kontrolce`,
    );
    assert.ok(
      textContent(carrier).replace(/\s+/g, " ").trim(),
      `${screen}: akcja ${action} bez widocznej etykiety`,
    );
  }
}

const expectedNamedFields = {
  "secondary-domains": ["domain"],
  "secondary-email-settings": ["senderName", "replyTo"],
  "secondary-email-history": ["status"],
  "secondary-contracts": ["companyAddress", "taxId", "companyEmail", "termsVersion", "termsBody"],
  "secondary-team": ["email", "role"],
  "secondary-organization": [],
  "secondary-security": ["code", "next"],
  "secondary-site-editor": [
    "template", "type", "heading", "subheading", "ctaText", "ctaHref", "note",
    "question", "answer", "email", "phone", "address", "mapQuery", "body",
  ],
};
for (const [screen, expected] of Object.entries(expectedNamedFields)) {
  const node = findAll(tree, (candidate) => candidate.attributes["data-screen"] === screen)[0];
  const actual = [...new Set(findAll(node, (candidate) =>
    ["input", "select", "textarea"].includes(candidate.tag) && candidate.attributes.type !== "hidden"
      ? candidate.attributes.name
      : candidate.tag === "input" && candidate.attributes.type === "hidden"
        ? candidate.attributes.name
        : undefined,
  ).map((candidate) => candidate.attributes.name).filter(Boolean))];
  assert.deepEqual(actual, expected, `${screen}: rozjazd pól danych`);
}

const secondaryStateAnchors = {
  "secondary-domains": ["data-dns-instructions", "data-domain-provider-availability"],
  "secondary-email-history": ["data-email-history-empty"],
  "secondary-delivery": ["data-delivery-access-rule"],
  "secondary-contracts": ["data-contract-mode"],
  "secondary-team": ["data-manual-invitation-link"],
  "secondary-organization": ["data-organization-details"],
  "secondary-security": ["data-security-state", "data-totp-qr", "data-totp-secret"],
  "secondary-site-editor": ["data-site-load-error-state", "data-site-sections-empty", "data-site-preview"],
};
for (const [screen, attributes] of Object.entries(secondaryStateAnchors)) {
  const node = findAll(tree, (candidate) => candidate.attributes["data-screen"] === screen)[0];
  for (const attribute of attributes) {
    assert.ok(findAll(node, (candidate) => attribute in candidate.attributes).length > 0, `${screen}: brak ${attribute}`);
  }
}
const siteEditor = findAll(tree, (node) => node.attributes["data-screen"] === "secondary-site-editor")[0];
assert.deepEqual(
  [...new Set(findAll(siteEditor, (node) => "data-section-type" in node.attributes)
    .map((node) => node.attributes["data-section-type"]))],
  ["hero", "products", "pricing", "faq", "contact", "freeform"],
);

const deliveryScreen = findAll(tree, (node) => node.attributes["data-screen"] === "secondary-delivery")[0];
const deliveryFields = findAll(deliveryScreen, (node) =>
  ["input", "select", "textarea"].includes(node.tag) && node.attributes.type !== "hidden" && "name" in node.attributes,
);
assert.equal(deliveryFields.length, 21, "Dostawy muszą pokazywać wszystkie 21 pól");
assert.deepEqual(
  [...new Set(findAll(deliveryScreen, (node) => "data-settings-form" in node.attributes)
    .map((node) => node.attributes["data-settings-form"]))],
  ["credentials", "sender", "parcel", "pricing"],
);

const secondaryChips = findAll(tree, (node) => "data-secondary-status-axis" in node.attributes);
assert.ok(secondaryChips.length >= 24, "Pokaż pełną semantykę statusów ekranów drugorzędnych");
const usedSecondaryStatuses = new Set();
for (const chip of secondaryChips) {
  const axis = chip.attributes["data-secondary-status-axis"];
  const value = chip.attributes["data-secondary-status-value"];
  const expectedTone = secondaryStatusMap[axis]?.[value];
  assert.ok(expectedTone, `Nieznany status drugorzędny ${axis}.${value}`);
  assert.equal(chip.attributes["data-tone"], expectedTone, `${axis}.${value}: błędny ton`);
  assert.ok((chip.attributes.class ?? "").split(/\s+/).includes(`chip-${expectedTone}`));
  usedSecondaryStatuses.add(`${axis}.${value}`);
}
assert.deepEqual(
  [...usedSecondaryStatuses].sort(),
  Object.entries(secondaryStatusMap).flatMap(([axis, values]) =>
    Object.keys(values).map((value) => `${axis}.${value}`)
  ).sort(),
  "Każdy status z secondary-status-map musi wystąpić w mockupach",
);

// ===== Recenzja PM: kontrolki native i linki UA =====
// Sama obecność klas nie dowodzi, że przeglądarka nie wróci do własnej
// kontrolki albo niebieskiego linku. Tak jak kontrakt fontów P1, sprawdzamy
// obliczony styl rzeczywistego DOM-u w jsdom. CSS variables są celowo
// rozwijane do wartości tokenów, bo jsdom zachowuje `var(...)` w `color`
// zamiast obliczyć końcowy kolor.
const jsdomPath = `${root}/packages/ui/node_modules/jsdom/lib/api.js`;
assert.ok(existsSync(jsdomPath), "Verifier wymaga jsdom z workspace @avably/ui");
const { JSDOM } = await import(pathToFileURL(jsdomPath).href);
const computedTokenCss = Object.entries({
  "--background": "#F4F6F5", "--foreground": "#0B1017", "--card": "#FFFFFF",
  "--card-foreground": "#0B1017", "--secondary": "#E9EDF0", "--secondary-foreground": "#0B1017",
  "--muted": "#E9EDF0", "--muted-foreground": "#53616C", "--primary": "#0B1017",
  "--primary-foreground": "#FFFFFF", "--accent": "#DCE9A8", "--accent-foreground": "#0B1017",
  "--destructive": "#A93226", "--destructive-foreground": "#FFFFFF", "--border": "#7E8994",
  "--input": "#7E8994", "--ring": "#5F7500", "--signal-strong": "#536A00",
}).reduce((resolved, [token, value]) => resolved.replaceAll(`var(${token})`, value), css)
  .replace(/@font-face\s*\{[\s\S]*?\}/g, "");
const computedDom = new JSDOM(html, { pretendToBeVisual: true });
const computedStyle = computedDom.window.document.createElement("style");
computedStyle.textContent = computedTokenCss;
computedDom.window.document.head.appendChild(computedStyle);
const systemComputedColors = new Set([
  "rgb(11, 16, 23)", "rgb(83, 97, 108)", "rgb(255, 255, 255)",
  "rgb(169, 50, 38)", "rgb(95, 117, 0)", "rgb(220, 233, 168)",
]);
const secondaryInteractive = computedDom.window.document.querySelectorAll(
  '[data-screen^="secondary-"] :is(a, button, input, select, textarea)',
);
assert.ok(secondaryInteractive.length > 0, "Kontrola UA wymaga interaktywnych elementów secondary-*");
for (const element of secondaryInteractive) {
  const computed = computedDom.window.getComputedStyle(element);
  assert.ok(
    systemComputedColors.has(computed.color),
    `${element.tagName.toLowerCase()} w secondary-* ma kolor spoza tokenów systemu: ${computed.color}`,
  );
  if (element.matches("a")) {
    assert.equal(computed.color, "rgb(11, 16, 23)", "Link secondary-* musi mieć jawny kolor ink");
    assert.match(computed.textDecoration, /underline/, "Link secondary-* musi mieć jawne podkreślenie");
  }
  if (element.matches('select, input[type="radio"]')) {
    assert.equal(computed.appearance, "none", `${element.tagName.toLowerCase()} nie może używać wyglądu UA`);
  }
}

const headings = findAll(tree, (node) => /^h[1-6]$/.test(node.tag));
assert.equal(headings.filter((node) => node.tag === "h1").length, 1);
for (let index = 1; index < headings.length; index += 1) {
  assert.ok(Number(headings[index].tag[1]) - Number(headings[index - 1].tag[1]) <= 1);
}
assert.equal(findAll(tree, (node) => node.tag === "main").length, 1);
for (const svg of findAll(tree, (node) => node.tag === "svg")) {
  assert.ok(svg.attributes["aria-label"] || svg.attributes["aria-hidden"] === "true");
}
for (const control of findAll(tree, (node) => ["button", "a", "input", "select", "textarea"].includes(node.tag))) {
  const visibleName = ["button", "a"].includes(control.tag)
    ? textContent(control).replace(/\s+/g, " ").trim()
    : "";
  const labelTarget = control.attributes.id
    ? findAll(tree, (node) => node.tag === "label" && node.attributes.for === control.attributes.id)
    : [];
  assert.ok(visibleName || control.attributes["aria-label"] || control.attributes.title || labelTarget.length > 0);
}

if (!process.argv.includes("--artifact-only")) {
  const hub = readFileSync(hubPath, "utf8");
  assert.match(hub, /href="\.\.\/branding\/2026-07-20-avably-faza-2-system\.html"/);
  assert.equal((hub.match(/2026-07-20-avably-faza-2-system\.html/g) ?? []).length, 1);
}

// The single contrast-registry invocation (grown by later tasks).
if (CONTRAST_REGISTRY_CALL) assertContrastRegistry(requiredContrasts);

if (!process.argv.includes("--artifact-only")) {
  assert.ok(existsSync(hubPath), `Brak huba: ${hubPath}`);
}

// ===== Warstwa 2: wyczerpujący skan kontrastu z policzonej kaskady =====
// Spec §15 wymaga „tabeli każdej realnie użytej pary". Rejestr
// `data-contrast-ref` (warstwa 1) jest OPT-IN — para niezadeklarowana nie
// istnieje dla kontraktu, więc wada w niezgłoszonej parze przechodzi.
// Ta warstwa liczy kontrast dla KAŻDEJ realnie malowanej pary tekst/tło,
// niezależnie od tego, co artefakt sam o sobie deklaruje.
// Zasada: wartości, której skan nie umie rozwiązać, NIE wolno pominąć.

const DEFAULT_BACKGROUND = "#FFFFFF";
const DEFAULT_FONT_SIZE = 16;
const DEFAULT_FONT_WEIGHT = 400;
const STATE_PSEUDOS = new Set([
  "hover", "active", "focus", "focus-visible", "focus-within", "disabled", "visited", "target",
]);

// Komentarze muszą zniknąć PRZED podziałem na reguły: prelude sięga od
// poprzedniego `}`, więc komentarz przed selektorem wchodziłby do selektora
// i cicho psuł dopasowanie (a przez to całą warstwę 2).
const cssForScan = css.replace(/\/\*[\s\S]*?\*\//g, "");

const cssRulesInOrder = [];
const cssMediaRules = [];
{
  let cursor = 0;
  while (cursor < cssForScan.length) {
    const braceIndex = cssForScan.indexOf("{", cursor);
    if (braceIndex === -1) break;
    let depth = 0;
    let end = -1;
    for (let index = braceIndex; index < cssForScan.length; index += 1) {
      if (cssForScan[index] === "{") depth += 1;
      else if (cssForScan[index] === "}") {
        depth -= 1;
        if (depth === 0) { end = index; break; }
      }
    }
    assert.notEqual(end, -1, "Niezbalansowany blok CSS w skanie kontrastu");
    const prelude = cssForScan.slice(cursor, braceIndex).trim();
    const body = cssForScan.slice(braceIndex + 1, end);
    if (prelude.startsWith("@")) {
      if (/^@media/i.test(prelude)) {
        for (const [, selector, innerBody] of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
          cssMediaRules.push({ prelude, selector: selector.trim(), body: innerBody });
        }
      }
    } else {
      const declarations = parseCssDeclarations(body);
      for (const branch of prelude.split(",").map((value) => value.trim()).filter(Boolean)) {
        cssRulesInOrder.push({ selector: branch, declarations, order: cssRulesInOrder.length });
      }
    }
    cursor = end + 1;
  }
}

// Skan celowo pomija @media. Strażnik pilnuje, żeby to założenie nie zgniło.
for (const { prelude, selector, body } of cssMediaRules) {
  assert.doesNotMatch(
    body,
    /(?:^|[;\s])(?:color|background|background-color)\s*:/,
    `${prelude} { ${selector} } maluje kolor, a wyczerpujący skan kontrastu @media nie obejmuje`,
  );
}

const splitSelectorParts = (text) => {
  const parts = [];
  let current = "";
  let combinator = null;
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === "[") {
      const close = text.indexOf("]", index);
      assert.notEqual(close, -1, `Niedomknięty [ w selektorze: ${text}`);
      current += text.slice(index, close + 1);
      index = close + 1;
      continue;
    }
    if (char === "(") {
      const close = text.indexOf(")", index);
      assert.notEqual(close, -1, `Niedomknięty ( w selektorze: ${text}`);
      current += text.slice(index, close + 1);
      index = close + 1;
      continue;
    }
    if (/\s/.test(char)) {
      let lookahead = index;
      while (lookahead < text.length && /\s/.test(text[lookahead])) lookahead += 1;
      if (">+~".includes(text[lookahead] ?? "")) {
        if (current) { parts.push({ compound: current, combinator }); current = ""; }
        combinator = text[lookahead];
        index = lookahead + 1;
        continue;
      }
      if (current) { parts.push({ compound: current, combinator }); current = ""; combinator = " "; }
      index = lookahead;
      continue;
    }
    if (">+~".includes(char)) {
      if (current) { parts.push({ compound: current, combinator }); current = ""; }
      combinator = char;
      index += 1;
      continue;
    }
    current += char;
    index += 1;
  }
  if (current) parts.push({ compound: current, combinator });
  return parts;
};

const parseCompoundUnit = (compound) => {
  const unit = { tag: null, id: null, classes: [], attributes: [], pseudos: [], pseudoElements: [] };
  const pattern = /::([\w-]+)|:([\w-]+)(?:\(([^)]*)\))?|\.([\w-]+)|#([\w-]+)|\[([^\]]+)\]|(\*)|([A-Za-z][\w-]*)/g;
  for (const match of compound.matchAll(pattern)) {
    const [, pseudoElement, pseudo, , className, id, attribute, star, tag] = match;
    if (pseudoElement) unit.pseudoElements.push(pseudoElement);
    else if (pseudo) unit.pseudos.push(pseudo);
    else if (className) unit.classes.push(className);
    else if (id) unit.id = id;
    else if (attribute) {
      const parsed = attribute.match(/^([\w-]+)(?:\s*([~^|$*]?=)\s*["']?([^"'\]]*)["']?)?$/);
      assert.ok(parsed, `Nieobsługiwany selektor atrybutu: [${attribute}]`);
      unit.attributes.push({ name: parsed[1], operator: parsed[2] ?? null, value: parsed[3] ?? null });
    } else if (star) unit.tag = "*";
    else if (tag) unit.tag = tag.toLowerCase();
  }
  return unit;
};

const specificityOfParts = (parts) => {
  const total = [0, 0, 0];
  for (const { compound } of parts) {
    const unit = parseCompoundUnit(compound);
    if (unit.id) total[0] += 1;
    total[1] += unit.classes.length + unit.attributes.length + unit.pseudos.length;
    if (unit.tag && unit.tag !== "*") total[2] += 1;
    total[2] += unit.pseudoElements.length;
  }
  return total;
};

const compareSpecificity = (left, right) => {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
};

const elementChildren = (node) => (node.children ?? []).filter((child) => child.tag !== "#text");

const compoundMatches = (node, unit, activeStates) => {
  if (unit.pseudoElements.length > 0) return false;
  if (unit.tag && unit.tag !== "*" && node.tag !== unit.tag) return false;
  if (unit.id && node.attributes.id !== unit.id) return false;
  const classList = (node.attributes.class ?? "").split(/\s+/).filter(Boolean);
  for (const className of unit.classes) {
    if (!classList.includes(className)) return false;
  }
  for (const { name, operator, value } of unit.attributes) {
    const actual = node.attributes[name];
    if (actual === undefined) return false;
    if (operator === null) continue;
    if (operator === "=" && actual !== value) return false;
    if (operator === "~=" && !actual.split(/\s+/).includes(value)) return false;
    if (operator === "^=" && !actual.startsWith(value)) return false;
    if (operator === "$=" && !actual.endsWith(value)) return false;
    if (operator === "*=" && !actual.includes(value)) return false;
  }
  for (const pseudo of unit.pseudos) {
    if (pseudo === "root") {
      if (node.tag !== "html") return false;
      continue;
    }
    if (STATE_PSEUDOS.has(pseudo)) {
      if (!activeStates.has(pseudo)) return false;
      continue;
    }
    const siblings = node.parent ? elementChildren(node.parent) : [node];
    if (pseudo === "first-child") { if (siblings[0] !== node) return false; continue; }
    if (pseudo === "last-child") { if (siblings.at(-1) !== node) return false; continue; }
    if (pseudo === "only-child") { if (siblings.length !== 1) return false; continue; }
    if (pseudo === "first-of-type") {
      if (siblings.find((sibling) => sibling.tag === node.tag) !== node) return false;
      continue;
    }
    if (pseudo === "last-of-type") {
      if (siblings.filter((sibling) => sibling.tag === node.tag).at(-1) !== node) return false;
      continue;
    }
    assert.fail(`Nieobsługiwana pseudo-klasa w skanie kontrastu: :${pseudo}`);
  }
  return true;
};

const selectorMatches = (node, parts, activeStates) => {
  let index = parts.length - 1;
  if (!compoundMatches(node, parseCompoundUnit(parts[index].compound), activeStates)) return false;
  let current = node;
  index -= 1;
  while (index >= 0) {
    const { compound } = parts[index];
    const combinator = parts[index + 1].combinator;
    const unit = parseCompoundUnit(compound);
    if (combinator === " ") {
      let ancestor = current.parent;
      let matched = false;
      while (ancestor && ancestor.tag !== "#document") {
        if (compoundMatches(ancestor, unit, activeStates)) { current = ancestor; matched = true; break; }
        ancestor = ancestor.parent;
      }
      if (!matched) return false;
    } else if (combinator === ">") {
      const parent = current.parent;
      if (!parent || parent.tag === "#document" || !compoundMatches(parent, unit, activeStates)) return false;
      current = parent;
    } else if (combinator === "+" || combinator === "~") {
      const siblings = current.parent ? elementChildren(current.parent) : [];
      const position = siblings.indexOf(current);
      if (position <= 0) return false;
      if (combinator === "+") {
        if (!compoundMatches(siblings[position - 1], unit, activeStates)) return false;
        current = siblings[position - 1];
      } else {
        const earlier = siblings.slice(0, position).reverse()
          .find((sibling) => compoundMatches(sibling, unit, activeStates));
        if (!earlier) return false;
        current = earlier;
      }
    } else {
      return false;
    }
    index -= 1;
  }
  return true;
};

for (const rule of cssRulesInOrder) {
  rule.parts = splitSelectorParts(rule.selector);
  rule.specificity = specificityOfParts(rule.parts);
  rule.hasPseudoElement = rule.selector.includes("::");
  rule.states = rule.parts
    .flatMap(({ compound }) => parseCompoundUnit(compound).pseudos)
    .filter((pseudo) => STATE_PSEUDOS.has(pseudo));
}

const inlineDeclarationsOf = (node) => parseCssDeclarations(node.attributes?.style ?? "");

const declaredValue = (node, property, activeStates) => {
  const inline = inlineDeclarationsOf(node).get(property);
  if (inline !== undefined) return inline;
  let best = null;
  for (const rule of cssRulesInOrder) {
    if (rule.hasPseudoElement) continue;
    const value = rule.declarations.get(property);
    if (value === undefined) continue;
    if (!selectorMatches(node, rule.parts, activeStates)) continue;
    if (best === null) { best = rule; continue; }
    const bySpecificity = compareSpecificity(rule.specificity, best.specificity);
    if (bySpecificity > 0 || (bySpecificity === 0 && rule.order > best.order)) best = rule;
  }
  return best?.declarations.get(property);
};

const resolveCustomProperty = (node, name, activeStates) => {
  for (let current = node; current && current.tag !== "#document"; current = current.parent) {
    const value = declaredValue(current, name, activeStates);
    if (value !== undefined) return value;
  }
  return undefined;
};

const splitTopLevelArguments = (text) => {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) { parts.push(current); current = ""; continue; }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim());
};

const resolveColorValue = (rawValue, node, activeStates, seen = new Set()) => {
  const value = (rawValue ?? "").trim();
  if (value === "" || value === "transparent" || value === "none") return null;
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    return `#${value.slice(1).split("").map((char) => char + char).join("")}`.toUpperCase();
  }
  const oklchMatch = value.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/i);
  if (oklchMatch) {
    return oklchToHex({ l: Number(oklchMatch[1]), c: Number(oklchMatch[2]), h: Number(oklchMatch[3]) });
  }
  const varMatch = value.match(/^var\(\s*(--[\w-]+)\s*(?:,([\s\S]*))?\)$/);
  if (varMatch) {
    const [, name, fallback] = varMatch;
    assert.ok(!seen.has(name), `Cykl var() przy ${name}`);
    const resolved = resolveCustomProperty(node, name, activeStates);
    if (resolved !== undefined) {
      return resolveColorValue(resolved, node, activeStates, new Set([...seen, name]));
    }
    if (fallback !== undefined) {
      return resolveColorValue(fallback, node, activeStates, new Set([...seen, name]));
    }
    return null;
  }
  assert.fail(`Skan kontrastu nie umie rozwiązać wartości koloru: „${value}"`);
  return null;
};

const computedColor = (node, activeStates) => {
  for (let current = node; current && current.tag !== "#document"; current = current.parent) {
    const declared = declaredValue(current, "color", activeStates);
    if (declared === undefined) continue;
    if (declared.trim() === "inherit") continue;
    const resolved = resolveColorValue(declared, current, activeStates);
    if (resolved) return resolved;
  }
  return "#000000";
};

const ownBackground = (node, activeStates) => {
  const shorthand = declaredValue(node, "background", activeStates);
  const explicit = declaredValue(node, "background-color", activeStates);
  const candidate = explicit ?? shorthand;
  if (candidate === undefined) return null;
  return resolveColorValue(candidate, node, activeStates);
};

const effectiveBackground = (node, activeStates) => {
  for (let current = node; current && current.tag !== "#document"; current = current.parent) {
    const background = ownBackground(current, activeStates);
    if (background) return { color: background, source: current };
  }
  return { color: DEFAULT_BACKGROUND, source: null };
};

const lengthToPx = (value, inheritedSize) => {
  const text = (value ?? "").trim();
  const match = text.match(/^([\d.]+)(px|rem|em)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (match[2] === "px") return amount;
  if (match[2] === "rem") return amount * DEFAULT_FONT_SIZE;
  return amount * inheritedSize;
};

const FONT_SHORTHAND = /^(?:(normal|bold|[1-9]00)\s+)?(?:(normal|italic)\s+)?([\d.]+(?:px|rem|em))(?:\s*\/\s*[^\s]+)?\s+/;

const computedFont = (node, activeStates) => {
  const chain = [];
  for (let current = node; current && current.tag !== "#document"; current = current.parent) chain.unshift(current);
  let size = DEFAULT_FONT_SIZE;
  let weight = DEFAULT_FONT_WEIGHT;
  for (const current of chain) {
    const shorthand = declaredValue(current, "font", activeStates);
    if (shorthand !== undefined) {
      const match = shorthand.trim().match(FONT_SHORTHAND);
      if (match) {
        const parsedSize = lengthToPx(match[3], size);
        if (parsedSize !== null) size = parsedSize;
        if (match[1]) weight = match[1] === "normal" ? 400 : match[1] === "bold" ? 700 : Number(match[1]);
        else weight = DEFAULT_FONT_WEIGHT;
      }
    }
    const declaredSize = declaredValue(current, "font-size", activeStates);
    if (declaredSize !== undefined) {
      const parsedSize = lengthToPx(declaredSize, size);
      if (parsedSize !== null) size = parsedSize;
    }
    const declaredWeight = declaredValue(current, "font-weight", activeStates);
    if (declaredWeight !== undefined) {
      const text = declaredWeight.trim();
      if (/^\d+$/.test(text)) weight = Number(text);
      else if (text === "bold") weight = 700;
      else if (text === "normal") weight = 400;
    }
  }
  return { size, weight };
};

const describeNode = (node) => {
  const chain = [];
  for (let current = node; current && current.tag !== "#document"; current = current.parent) {
    const id = current.attributes.id ? `#${current.attributes.id}` : "";
    const classes = (current.attributes.class ?? "").split(/\s+/).filter(Boolean).map((name) => `.${name}`).join("");
    chain.unshift(`${current.tag}${id}${classes}`);
  }
  return chain.slice(-4).join(" > ");
};

const directText = (node) => (node.children ?? [])
  .filter((child) => child.tag === "#text")
  .map((child) => decodeHtmlEntities(child.value))
  .join("")
  .replace(/\s+/g, " ")
  .trim();

const HIDDEN_TAGS = new Set(["script", "style", "title", "symbol", "defs", "head"]);

const isRendered = (node) => {
  for (let current = node; current && current.tag !== "#document"; current = current.parent) {
    if (HIDDEN_TAGS.has(current.tag)) return false;
    if (current.attributes["aria-hidden"] === "true") return false;
    if ("hidden" in current.attributes) return false;
    const display = declaredValue(current, "display", new Set());
    if (display !== undefined && display.trim() === "none") return false;
  }
  return true;
};

const contrastFindings = [];
const scanTextNodes = findAll(tree, (node) => directText(node).length > 0 && isRendered(node));
assert.ok(scanTextNodes.length >= 945, `Skan kontrastu skurczył się do ${scanTextNodes.length} par`);

for (const node of scanTextNodes) {
  const activeStates = new Set();
  const foreground = computedColor(node, activeStates);
  const { color: background } = effectiveBackground(node, activeStates);
  const { size, weight } = computedFont(node, activeStates);
  const isLarge = size >= 24 || (size >= 18.66 && weight >= 700);
  const minimum = isLarge ? 3 : 4.5;
  const ratio = contrastRatio(foreground, background);
  if (ratio + 1e-9 < minimum) {
    contrastFindings.push({
      path: describeNode(node),
      text: directText(node).slice(0, 48),
      foreground,
      background,
      size,
      weight,
      minimum,
      ratio: Number(ratio.toFixed(2)),
    });
  }
}

assert.equal(
  contrastFindings.length,
  0,
  `Wyczerpujący skan kontrastu — pary poniżej progu WCAG:\n${
    contrastFindings.map((finding) =>
      `  • ${finding.path}\n      tekst: „${finding.text}"\n      ${finding.foreground} na ${finding.background}` +
      ` = ${finding.ratio}:1 (próg ${finding.minimum}, ${finding.size}px/${finding.weight})`,
    ).join("\n")
  }`,
);

console.log(`phase2_contrast_scan=${scanTextNodes.length} par tekst/tło policzonych`);

console.log("phase2_contract=passed");
