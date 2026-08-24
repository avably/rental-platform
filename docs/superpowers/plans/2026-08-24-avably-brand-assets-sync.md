# Avably Brand Assets Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every platform-owned Avably logo, symbol, favicon and application icon with the approved capsule logo and dot-only symbol, while keeping public asset URLs stable.

**Architecture:** Storefront marketing SVG strings live in one small ESM module imported by the existing Webflow rebuild script and verified against committed public assets. The panel keeps its existing React SVG component, with the symbol reduced to exact dot-only geometry. A committed handoff kit supplies human-facing SVG/PNG/ZIP assets and the raster sources used to assemble identical multi-frame ICO files for both Next applications.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Node.js ESM scripts, SVG, PNG and ICO binary assets, pnpm/turbo.

## Global Constraints

- Full logo: `viewBox="0 0 348 93"`, capsule `348 × 93`, `rx="44"`, `#EAFFA4`; dot `cx="57.5"`, `cy="46"`, `r="15"`, `#A8C743`; six frozen wordmark paths in `#0B1017`, translated by `-2` on X.
- Symbol: `viewBox="0 0 96 96"`, field `rx="25"`, `#0B1017`; one dot `cx="48"`, `cy="48"`, `r="25"`, `#A8C743`; no letter and no path.
- Keep `/forerunner/images/avably-logo-dark.svg`, `/forerunner/images/avably-logo-light.svg` and `/forerunner/images/avably-favicon.svg` stable.
- Do not modify Starkit, tenant-uploaded logos, tenant storefront branding, tenant e-mail/PDF logos, layout, copy, fonts or UI tokens.
- Do not add a PWA manifest, merge the branch or deploy it.
- All commits use `Avably <admin@avably.io>` without AI/co-author metadata.
- Node.js commands use the repository-required Node 22+ runtime.

---

## File map

- `apps/panel/components/shell/brand-mark.tsx` — React rendering of the full logo and dot-only symbol.
- `apps/panel/test/panel-shell-contract.test.tsx` — exact geometry and minimum-size contract for panel marks.
- `apps/storefront/scripts/brand-assets.mjs` — canonical full-logo and favicon SVG strings for marketing rebuilds.
- `apps/storefront/scripts/build-marketing-html.mjs` — consumes canonical marketing brand files.
- `apps/storefront/public/forerunner/images/avably-logo-{dark,light}.svg` — stable full-logo URLs.
- `apps/storefront/public/forerunner/images/avably-favicon.svg` — stable dot-only SVG favicon URL.
- `apps/storefront/test/platform-brand-assets.test.ts` — verifies marketing source, committed SVGs, PNGs and ICO structure.
- `apps/{panel,storefront}/app/favicon.ico` — identical multi-frame browser fallback.
- `apps/{panel,storefront}/app/icon.png` — identical `512 × 512` Next application icon.
- `apps/{panel,storefront}/app/apple-icon.png` — identical `180 × 180` Apple icon.
- `docs/branding/avably-logo-kit/**` — complete human-facing SVG/PNG/preview/ZIP handoff.
- `scripts/verify-avably-logo-kit.mjs` — dependency-free handoff verifier.
- `scripts/verify-branding-phase2.mjs` — validates the updated dot-only examples in the phase-2 artifact.
- `docs/branding/2026-07-20-avably-faza-2-system.html` — current symbol/favicon guidance.
- `docs/dokumentacja/index.html` — newest-first build-log entry.
- `package.json` — adds the logo-kit verifier to `verify:branding`.

---

### Task 1: Pin the dot-only panel and storefront contracts

**Files:**
- Modify: `apps/panel/test/panel-shell-contract.test.tsx`
- Create: `apps/storefront/test/platform-brand-assets.test.ts`

**Interfaces:**
- Consumes: existing `BrandLogo`, `BrandSymbol` and committed marketing SVG paths.
- Produces: an exact executable contract for `FULL_LOGO_SVG`, `FAVICON_SVG`, panel JSX, PNG dimensions and ICO entries.

- [ ] **Step 1: Replace the old panel symbol-path assertion with exact geometry assertions**

Keep the six-path frozen wordmark check, require zero paths in `BrandSymbol`, and add:

```ts
expect(symbol).toContain('viewBox="0 0 96 96"');
expect(symbol).toContain('<rect width="96" height="96" rx="25" fill="#0B1017"></rect>');
expect(symbol).toContain('<circle data-brand-dot="true" cx="48" cy="48" r="25" fill="#A8C743"></circle>');
expect(paths(symbol)).toEqual([]);
expect(symbol).not.toContain("translate(");
```

- [ ] **Step 2: Add the storefront brand-assets test with binary parsers**

Create a Vitest file that imports `BRAND_FILES` from `../scripts/brand-assets.mjs`, reads the three public SVGs, reads both applications' icons, and defines dependency-free helpers:

```ts
function pngSize(buffer: Buffer) {
  expect(buffer.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function icoSizes(buffer: Buffer) {
  expect(buffer.readUInt16LE(0)).toBe(0);
  expect(buffer.readUInt16LE(2)).toBe(1);
  const count = buffer.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const offset = 6 + index * 16;
    return [buffer[offset] || 256, buffer[offset + 1] || 256];
  });
}
```

Assertions require the two full SVG strings and public files to be identical, require the full capsule plus six paths, require the SVG favicon to have the `32 × 32` equivalent dot-only geometry and zero paths, require panel/storefront icon files to be byte-identical, require PNG sizes `512` and `180`, and require ICO entries for at least `16`, `24`, `32` and `48`.

- [ ] **Step 3: Run the focused tests and observe the intended failures**

Run:

```bash
pnpm --filter panel exec vitest run test/panel-shell-contract.test.tsx
pnpm --filter storefront exec vitest run test/platform-brand-assets.test.ts
```

Expected: panel fails because `BrandSymbol` still contains the `A` path and old colors; storefront fails because `brand-assets.mjs`, PNG icons and the new ICO contract do not exist yet.

- [ ] **Step 4: Commit the red contract**

```bash
git add apps/panel/test/panel-shell-contract.test.tsx apps/storefront/test/platform-brand-assets.test.ts
git commit -m "test(brand): przypnij znaki platformy Avably"
```

---

### Task 2: Synchronize vector marks and the marketing generator

**Files:**
- Modify: `apps/panel/components/shell/brand-mark.tsx`
- Create: `apps/storefront/scripts/brand-assets.mjs`
- Modify: `apps/storefront/scripts/build-marketing-html.mjs`
- Modify: `apps/storefront/public/forerunner/images/avably-logo-dark.svg`
- Modify: `apps/storefront/public/forerunner/images/avably-logo-light.svg`
- Modify: `apps/storefront/public/forerunner/images/avably-favicon.svg`

**Interfaces:**
- Consumes: the six frozen wordmark paths already used by `BrandLogo`.
- Produces: `export const FULL_LOGO_SVG`, `export const FAVICON_SVG`, and `export const BRAND_FILES` for the marketing builder and tests.

- [ ] **Step 1: Implement the minimal dot-only panel symbol**

Replace the old symbol body with:

```tsx
<rect width="96" height="96" rx="25" fill="#0B1017" />
<circle data-brand-dot cx="48" cy="48" r="25" fill="#A8C743" />
```

Update the file comment so it describes `full-lime` and the current dot-only `symbol-color` rather than the retired phase-2 `A` path.

- [ ] **Step 2: Extract canonical marketing SVG strings**

Create `brand-assets.mjs` with the exact six-path `WORDMARK_PATHS` string and:

```js
export const FULL_LOGO_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 348 93" role="img" aria-label="Avably"><rect width="348" height="93" rx="44" fill="#EAFFA4"/><circle cx="57.5" cy="46" r="15" fill="#A8C743"/><g transform="translate(-2 0)" fill="#0B1017">${WORDMARK_PATHS}</g></svg>\n`;

export const FAVICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="Avably"><rect width="32" height="32" rx="7" fill="#0B1017"/><circle cx="16" cy="16" r="8" fill="#A8C743"/></svg>\n';

export const BRAND_FILES = {
  "avably-logo-dark.svg": FULL_LOGO_SVG,
  "avably-logo-light.svg": FULL_LOGO_SVG,
  "avably-favicon.svg": FAVICON_SVG,
};
```

- [ ] **Step 3: Make the marketing rebuild consume the canonical module**

Import `BRAND_FILES` from `./brand-assets.mjs` and delete the old local `WORDMARK_PATHS`, `wordmark` and `BRAND_FILES` definitions. Preserve `BRAND_IMAGES` and all public URL rewrites.

- [ ] **Step 4: Replace the committed public SVG files exactly**

Write `FULL_LOGO_SVG` byte-for-byte to both `avably-logo-*.svg` paths and `FAVICON_SVG` to `avably-favicon.svg`.

- [ ] **Step 5: Run focused vector tests**

Run:

```bash
pnpm --filter panel exec vitest run test/panel-shell-contract.test.tsx
pnpm --filter storefront exec vitest run test/platform-brand-assets.test.ts
pnpm --filter storefront exec vitest run test/marketing-template.test.ts test/embed-widget.test.tsx
```

Expected: panel and vector/public-URL assertions pass; raster assertions remain red until Task 3.

- [ ] **Step 6: Commit vector synchronization**

```bash
git add apps/panel/components/shell/brand-mark.tsx apps/panel/test/panel-shell-contract.test.tsx apps/storefront/scripts/brand-assets.mjs apps/storefront/scripts/build-marketing-html.mjs apps/storefront/public/forerunner/images/avably-logo-dark.svg apps/storefront/public/forerunner/images/avably-logo-light.svg apps/storefront/public/forerunner/images/avably-favicon.svg apps/storefront/test/platform-brand-assets.test.ts
git commit -m "feat(brand): zsynchronizuj wektorowe znaki Avably"
```

---

### Task 3: Add the handoff kit and application icons

**Files:**
- Create: `docs/branding/avably-logo-kit/**`
- Create: `scripts/verify-avably-logo-kit.mjs`
- Modify: `package.json`
- Modify: `apps/panel/app/favicon.ico`
- Create: `apps/panel/app/icon.png`
- Create: `apps/panel/app/apple-icon.png`
- Modify: `apps/storefront/app/favicon.ico`
- Create: `apps/storefront/app/icon.png`
- Create: `apps/storefront/app/apple-icon.png`

**Interfaces:**
- Consumes: the approved pre-generated logo kit, including `png/favicon/avably-favicon-{16,24,32,48}.png` and `png/app-icon/avably-app-icon-{180,192,512}.png`.
- Produces: identical runtime icon bytes for panel/storefront and `node scripts/verify-avably-logo-kit.mjs`.

- [ ] **Step 1: Copy the approved kit without macOS metadata**

Copy only `README.md`, `svg/`, `png/`, `preview/` and `avably-logo-kit.zip` into `docs/branding/avably-logo-kit/`. Do not copy `.DS_Store` or the accidental nested duplicate directory.

- [ ] **Step 2: Assemble a deterministic multi-frame ICO**

Create the ICO from the four committed favicon PNG buffers. The file starts with `ICONDIR` (`reserved=0`, `type=1`, `count=4`), followed by four 16-byte directory entries and then the unchanged PNG payloads. Each entry sets width/height to `16`, `24`, `32` or `48`, planes to `1`, bits-per-pixel to `32`, and byte size/offset to the corresponding payload. Write the same resulting bytes to both applications.

- [ ] **Step 3: Install the Next conventional PNG icons**

Copy `avably-app-icon-512.png` to both `app/icon.png` paths and `avably-app-icon-180.png` to both `app/apple-icon.png` paths. These source PNGs already contain the approved `12.5%` transparent safe margin.

- [ ] **Step 4: Add a dependency-free kit verifier**

The script checks the exact SVG filename set, rejects scripts/external URLs/fonts/text, checks the six frozen paths in every full-logo variant, checks dot-only symbol geometry, parses PNG IHDR dimensions, lists ZIP entries with `unzip -Z1`, and rejects `.DS_Store` or a nested ZIP. End with:

```js
console.log("Avably logo kit verification: PASS");
```

Append the verifier to the root command:

```json
"verify:branding": "node scripts/verify-branding-moodboard.mjs && node scripts/verify-branding-phase2.mjs && node scripts/verify-avably-logo-kit.mjs"
```

- [ ] **Step 5: Run the handoff and runtime-asset tests**

Run:

```bash
node scripts/verify-avably-logo-kit.mjs
pnpm --filter storefront exec vitest run test/platform-brand-assets.test.ts
```

Expected: verifier prints `Avably logo kit verification: PASS`; the storefront test passes all SVG, PNG and ICO assertions.

- [ ] **Step 6: Commit the handoff and icons**

```bash
git add docs/branding/avably-logo-kit scripts/verify-avably-logo-kit.mjs package.json apps/panel/app/favicon.ico apps/panel/app/icon.png apps/panel/app/apple-icon.png apps/storefront/app/favicon.ico apps/storefront/app/icon.png apps/storefront/app/apple-icon.png apps/storefront/test/platform-brand-assets.test.ts
git commit -m "feat(brand): dodaj paczke logo i ikony aplikacji"
```

---

### Task 4: Update the phase-2 artifact and living documentation

**Files:**
- Modify: `docs/branding/2026-07-20-avably-faza-2-system.html`
- Modify: `scripts/verify-branding-phase2.mjs`
- Modify: `docs/dokumentacja/index.html`

**Interfaces:**
- Consumes: the exact dot-only geometry and completed application file map.
- Produces: an artifact/verifier pair that describes current branding and a newest-first PM build-log entry.

- [ ] **Step 1: Make the verifier reject retired symbol geometry**

Change the symbol checks to require the dark `96 × 96` field, centered `r=25` dot and no `A` path in each current color example. Keep all unrelated phase-2 structure, accessibility and offline checks intact.

- [ ] **Step 2: Run the verifier red**

Run:

```bash
node scripts/verify-branding-phase2.mjs
```

Expected: FAIL on the old phase-2 symbol/favicon examples.

- [ ] **Step 3: Update only symbol and favicon examples in the HTML artifact**

Replace `kropka + A` diagrams and guidance with the approved dot-only field. Preserve the full capsule logo, section order, IDs, CSS theme, offline behavior and historical phase labels. Copy must state that the favicon never contains `A`.

- [ ] **Step 4: Add the newest build-log entry**

At the top of `#dziennik`, add a `2026-08-24` entry that names the synchronized LP/panel surfaces, stable marketing URLs, generator fix, dot-only browser icons, logo handoff, validation and the explicit exclusions: tenant branding, Starkit, merge and deploy.

- [ ] **Step 5: Run documentation verification**

Run:

```bash
pnpm verify:branding
```

Expected: moodboard, phase-2 artifact and logo-kit verification all pass.

- [ ] **Step 6: Commit documentation synchronization**

```bash
git add docs/branding/2026-07-20-avably-faza-2-system.html scripts/verify-branding-phase2.mjs docs/dokumentacja/index.html
git commit -m "docs(brand): uaktualnij standard znakow Avably"
```

---

### Task 5: Full automated and visual verification

**Files:**
- Modify only if verification exposes an in-scope branding defect.
- Create: `docs/proof/avably-brand-assets/` for final local screenshots if the existing proof convention is used.

**Interfaces:**
- Consumes: all earlier tasks.
- Produces: evidence-backed PM handoff with no merge or deploy.

- [ ] **Step 1: Search for retired platform marks**

Run focused searches for the old symbol transform, the old lime symbol field, transparent LP wordmarks and triangle-icon hashes. Inspect every hit and exclude only historical prose or tenant-controlled branding.

- [ ] **Step 2: Run focused tests and static checks**

```bash
pnpm --filter panel exec vitest run test/panel-shell-contract.test.tsx
pnpm --filter storefront exec vitest run test/platform-brand-assets.test.ts test/marketing-template.test.ts test/embed-widget.test.tsx
pnpm verify:branding
pnpm typecheck
pnpm lint
```

Expected: all commands exit `0`.

- [ ] **Step 3: Build both applications**

```bash
pnpm --filter panel build
pnpm --filter storefront build
```

Expected: both production builds exit `0` without missing asset or metadata warnings.

- [ ] **Step 4: Run the monorepo regression suite with the documented DB skip**

```bash
ALLOW_INTEGRATION_SKIP=1 pnpm test
```

Expected: all non-integration tests pass. If the known protected-route case times out only under full-suite load, rerun that exact test separately and report both results rather than hiding the baseline condition.

- [ ] **Step 5: Perform local visual QA**

Check LP PL/EN at desktop and mobile widths, the embedded widget on light/dark surfaces, panel auth, expanded/collapsed sidebar and superadmin bar, plus browser favicon behavior. Confirm minimum rendered widths `120 px` for the full logo and `24 px` for the symbol.

- [ ] **Step 6: Review the diff and preserve branch isolation**

```bash
git diff origin/main...HEAD --check
git status --short --branch
git log --oneline --decorate origin/main..HEAD
```

Expected: no whitespace errors or uncommitted files; branch remains ahead of `origin/main` and unmerged.

- [ ] **Step 7: Prepare the PM summary**

Report the branch, commits, exact changed surfaces, test/build results, known baseline caveat if it recurs, logo-kit path and deployment cache checks for `www.avably.io` and `app.avably.io`. Do not merge, deploy or push without new authorization.
