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

if (!process.argv.includes("--artifact-only")) {
  assert.ok(existsSync(hubPath), `Brak huba: ${hubPath}`);
}

console.log("phase2_contract=passed");
