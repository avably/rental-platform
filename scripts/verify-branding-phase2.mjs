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
assert.equal(matrixChips.length, 20);
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
  { order: 6, payment: 8, shipment: 6 },
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
const panelNavs = findAll(tree, (node) => node.tag === "nav" && node.attributes["data-panel-nav"] === "true");
assert.ok(panelNavs.length >= 2, "Pokaż nawigację w jasnym i ciemnym shellu");
for (const nav of panelNavs) {
  const items = directChildren(nav, (node) => "data-nav-item" in node.attributes);
  assert.deepEqual(items.map((node) => node.attributes["data-nav-item"]), [
    "orders", "catalog", "store", "domains", "emails", "delivery", "team", "organization", "security",
  ]);
  assert.equal(directChildren(nav, (node) => node.attributes["data-nav-placeholder"] === "dashboard").length, 1);
  assert.equal(items.filter((node) => node.attributes["aria-current"] === "page").length, 1);
  assert.equal(items.find((node) => node.attributes["aria-current"] === "page").attributes["data-nav-item"], "orders");
}
assert.match(html, /\.sidebar-nav[^}]*\[aria-current="page"\][^}]*border-left:\s*2px solid var\(--signal-strong\)/);
assert.match(html, /\.dark[^}]*\.sidebar-nav[^}]*\[aria-current="page"\][^}]*border-left:\s*2px solid var\(--accent-foreground\)/);

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

// The single contrast-registry invocation (grown by later tasks).
if (CONTRAST_REGISTRY_CALL) assertContrastRegistry(requiredContrasts);

if (!process.argv.includes("--artifact-only")) {
  assert.ok(existsSync(hubPath), `Brak huba: ${hubPath}`);
}

console.log("phase2_contract=passed");
