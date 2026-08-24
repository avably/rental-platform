import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const root = path.join(repoRoot, "docs/branding/avably-logo-kit");
const svgRoot = path.join(root, "svg");
const expectedSvgs = [
  "avably-favicon-16-dark.svg",
  "avably-favicon-16-light.svg",
  "avably-favicon-24-dark.svg",
  "avably-favicon-24-light.svg",
  "avably-full-canvas.svg",
  "avably-full-dark.svg",
  "avably-full-lime.svg",
  "avably-full-white.svg",
  "avably-grayscale.svg",
  "avably-symbol-color.svg",
  "avably-symbol-mono.svg",
  "avably-symbol-negative.svg",
].sort();

const approvedPaths = [
  "M280.703 69.8609L268.659 33.4453H276.31L287.434 68.7273L299.336 33.4453H307.2L289.063 84.7389H281.482L286.938 69.8609H280.703Z",
  "M258.992 69.8588V20.2656H266.077V69.8588H258.992Z",
  "M239.521 70.7799C231.302 70.7799 226.627 64.8287 225.422 56.7521V69.8588H218.337V20.2656H225.422V45.9833C226.627 37.6233 232.436 32.5222 239.521 32.5222C248.944 32.5222 255.461 40.528 255.461 51.7219C255.461 62.6324 248.802 70.7799 239.521 70.7799ZM225.139 51.7219C225.139 58.8066 229.815 64.3327 236.616 64.3327C243.205 64.3327 248.235 59.4443 248.235 51.7219C248.235 44.1412 243.205 38.9694 236.758 38.9694C230.381 38.9694 225.139 43.6453 225.139 51.7219Z",
  "M193.072 70.7811C185.775 70.7811 180.603 66.0343 180.603 59.2329C180.603 52.4316 185.633 48.4641 192.647 47.7556L205.045 46.4804C204.974 42.1587 201.857 38.758 196.402 38.758C191.372 38.758 188.963 41.9461 188.325 44.8509L182.02 43.0089C183.649 36.6326 188.892 32.5234 196.402 32.5234C207.029 32.5234 211.988 39.6082 211.988 46.9055V69.86H204.974V58.6662C204.974 66.3885 200.015 70.7811 193.072 70.7811ZM187.688 59.2329C187.688 62.7045 190.663 64.9007 194.56 64.9007C202.07 64.9007 205.045 59.4455 205.045 54.2736V52.2899L194.205 53.4234C189.884 53.9194 187.688 55.9031 187.688 59.2329Z",
  "M154.973 69.8609L143.071 33.4453H150.581L161.775 68.7982L172.543 33.4453H180.195L168.292 69.8609H154.973Z",
  "M100.8 69.8588L116.599 20.2656H130.556L146.355 69.8588H138.774L135.303 58.8775H111.781L108.31 69.8588H100.8ZM113.907 52.0053H133.177L123.542 21.3992L113.907 52.0053Z",
];

function pngSize(buffer) {
  assert.equal(buffer.subarray(1, 4).toString("ascii"), "PNG");
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

const actualSvgs = (await readdir(svgRoot)).filter((name) => name.endsWith(".svg")).sort();
assert.deepEqual(actualSvgs, expectedSvgs);

for (const name of actualSvgs) {
  const source = await readFile(path.join(svgRoot, name), "utf8");
  assert.match(source, /^<svg\b[\s\S]*<\/svg>\n$/);
  assert.doesNotMatch(source, /<use\b|<script\b|(?:href|src)="https?:\/\/|url\(\s*https?:\/\/|@font-face|<text\b/);
  if (name.startsWith("avably-full-") || name === "avably-grayscale.svg") {
    const paths = [...source.matchAll(/<path\b[^>]*d="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(paths, approvedPaths, `${name}: frozen wordmark paths changed`);
  }
}

const fullVariants = await Promise.all(
  ["lime", "white", "canvas", "dark"].map((name) =>
    readFile(path.join(svgRoot, `avably-full-${name}.svg`), "utf8"),
  ),
);
for (const source of fullVariants.slice(1)) assert.equal(source, fullVariants[0]);

const colorSymbol = await readFile(path.join(svgRoot, "avably-symbol-color.svg"), "utf8");
assert.match(colorSymbol, /<rect width="96" height="96" rx="25" fill="#0B1017"\/>/);
assert.match(colorSymbol, /<circle cx="48" cy="48" r="25" fill="#A8C743"\/>/);
assert.doesNotMatch(colorSymbol, /<path\b/);

for (const size of [16, 24, 32, 48]) {
  const buffer = await readFile(path.join(root, "png/favicon", `avably-favicon-${size}.png`));
  assert.deepEqual(pngSize(buffer), [size, size]);
}
for (const size of [180, 192, 512]) {
  const buffer = await readFile(path.join(root, "png/app-icon", `avably-app-icon-${size}.png`));
  assert.deepEqual(pngSize(buffer), [size, size]);
}

await stat(path.join(root, "README.md"));
await stat(path.join(root, "preview/avably-logo-contact-sheet.png"));
const zip = path.join(root, "avably-logo-kit.zip");
await stat(zip);
const zipEntries = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" });
assert.match(zipEntries, /^svg\//m);
assert.match(zipEntries, /^png\//m);
assert.match(zipEntries, /^preview\/avably-logo-contact-sheet\.png$/m);
assert.match(zipEntries, /^README\.md$/m);
assert.doesNotMatch(zipEntries, /\.DS_Store|avably-logo-kit\.zip/);

const allEntries = await readdir(root, { recursive: true });
assert.ok(!allEntries.some((entry) => entry.endsWith(".DS_Store")));

console.log("Avably logo kit verification: PASS");
