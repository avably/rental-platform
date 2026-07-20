import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const artifactPath = `${root}/docs/branding/2026-07-20-avably-faza-1-moodboard.html`;
const hubPath = `${root}/docs/dokumentacja/hub.html`;
assert.ok(existsSync(artifactPath), `Brak moodboardu: ${artifactPath}`);
const html = readFileSync(artifactPath, "utf8");
const count = (needle) => html.split(needle).length - 1;

assert.match(html, /^<!doctype html>/i);
assert.match(html, /<html lang="pl">/);
assert.equal(count("<style>"), 1);
assert.equal(count("data:font/woff2;base64,"), 7);
assert.doesNotMatch(html, /https?:\/\//i);
assert.doesNotMatch(html, /<script\b|<link\b/i);
assert.doesNotMatch(
  html,
  /linear-gradient|radial-gradient|backdrop-filter|box-shadow/i,
);
assert.match(html, /font-synthesis:\s*none/);

for (const font of ["Safiro", "Manrope", "Geist Sans", "Geist Mono"]) {
  assert.ok(html.includes(`font-family: "${font}"`), `Brak fontu ${font}`);
}

for (const direction of [
  "Sygnał operacyjny",
  "Papier roboczy",
  "Czarna rama",
]) {
  assert.ok(html.includes(direction), `Brak kierunku ${direction}`);
}

for (const repeatedCopy of [
  "Prowadź wynajem. Przyjmuj rezerwacje online.",
  "Jeden egzemplarz. Jeden termin. Jedna rezerwacja.",
  "Klient rezerwuje online. Zamówienie od razu trafia do panelu.",
]) {
  assert.equal(count(repeatedCopy), 3, `Copy nie występuje trzy razy: ${repeatedCopy}`);
}

for (const datum of [
  "ZAM/2026/0714",
  "Anna Kowalska",
  "Nagrzewnica 20 kW",
  "20–22.07.2026",
  "1 199,00 zł",
  "Do wydania",
]) {
  assert.ok(html.includes(datum), `Brak danych demonstracyjnych: ${datum}`);
}

for (const ratio of [
  /aspect-ratio:\s*16\s*\/\s*10/,
  /aspect-ratio:\s*1\s*\/\s*1/,
  /aspect-ratio:\s*4\s*\/\s*5/,
]) {
  assert.match(html, ratio);
}

for (const sectionId of [
  "logo",
  "directions",
  "applications",
  "typography",
  "contrast",
  "motion",
  "not-included",
  "choice",
]) {
  assert.ok(html.includes(`id="${sectionId}"`), `Brak sekcji #${sectionId}`);
}

for (const value of [
  "17.57:1",
  "19.08:1",
  "9.92:1",
  "1.09:1",
  "#EAFFA4",
  "#A8C743",
  "#0B1017",
  "#122035",
]) {
  assert.ok(html.includes(value), `Brak wartości ${value}`);
}

for (const motionToken of [
  "--motion-fast: 160ms",
  "--motion-ui: 240ms",
  "--motion-reveal: 720ms",
  "--motion-logo: 6000ms",
  "--motion-ad: 8000ms",
  "--motion-ambient: 16000ms",
  "cubic-bezier(0.22, 1, 0.36, 1)",
  "cubic-bezier(0.2, 0.7, 0.2, 1)",
]) {
  assert.ok(html.includes(motionToken), `Brak wartości motion: ${motionToken}`);
}

for (const keyframe of [
  "logo-signal",
  "ui-state",
  "operational-rail",
  "ad-sequence",
]) {
  assert.ok(html.includes(`@keyframes ${keyframe}`), `Brak animacji ${keyframe}`);
}

assert.equal(count("data-motion-demo"), 12);
assert.match(html, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
assert.match(html, /animation-play-state:\s*paused/);
assert.match(html, /animation:\s*none\s*!important/);
assert.match(html, /transition:\s*none\s*!important/);

assert.match(html, /Faza 2 nie została rozpoczęta/);

if (!process.argv.includes("--artifact-only")) {
  const hub = readFileSync(hubPath, "utf8");
  assert.ok(
    hub.includes("../branding/2026-07-20-avably-faza-1-moodboard.html"),
    "Hub nie zawiera odnośnika do moodboardu",
  );
}

console.log("moodboard_contract=passed");
