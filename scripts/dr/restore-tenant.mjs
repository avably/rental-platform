#!/usr/bin/env node
// @ts-check
/**
 * Szkielet punktowego odtwarzania JEDNEGO najemcy po awarii (Disaster Recovery, I5.7).
 *
 * CO TO JEST. Scaffold planera odtworzenia danych POJEDYNCZEGO tenanta z manifestu
 * eksportu per-najemca (format z I5.6 — art. 20 RODO / DR). Skrypt czyta manifest z
 * LOKALNEGO pliku, waliduje jego kształt i wypisuje PLAN wstawiania (dry-run): które
 * tabele, ile rekordów, w jakiej kolejności respektującej klucze obce i granicę
 * tenanta, gdzie leżą sekrety i jak je odszyfrować, co z plikami w storage.
 *
 * CZEGO NIE ROBI (twarde granice — I5.7, przed decyzjami właściciela B4):
 *   • ZERO dostępu do sieci i do produkcji — czyta wyłącznie plik manifestu z dysku.
 *   • ZERO zapisu do jakiejkolwiek bazy — `--dry-run` jest DOMYŚLNE i jedyne wykonalne.
 *   • Realne wstawianie jest ZAGWOŻDŻONE: `--execute` rzuca błędem, bo wymaga
 *     gotowego backupu/PITR i depozytu klucza szyfrującego — to decyzje właściciela
 *     (patrz docs/operacje/runbook-dr-avably.md, sekcja „DO USTALENIA PO B4").
 *   • Node ESM, wyłącznie wbudowane moduły `node:*` — zero zależności spoza repo.
 *
 * UŻYCIE:
 *   node scripts/dr/restore-tenant.mjs --dry-run <ścieżka-do-manifestu.json>
 *   node scripts/dr/restore-tenant.mjs --example > /tmp/manifest.json   # wzorcowy manifest
 *   node scripts/dr/restore-tenant.mjs --help
 *
 * TODO(I5.6): kształt manifestu poniżej to ROZSĄDNE ZAŁOŻENIE — eksport per-najemca
 * nie jest jeszcze zmergowany. Po jego finalizacji dopiąć `MANIFEST_VERSION`, nazwy
 * pól i format plików danych do rzeczywistego kontraktu I5.6.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { argv, exit, stderr, stdout } from "node:process";
import { parseArgs } from "node:util";

/** Wersja kształtu manifestu, jakiego oczekuje TEN szkielet. TODO(I5.6): dopiąć do finalnej. */
const EXPECTED_MANIFEST_VERSION = "0.1-draft";

/**
 * Kanoniczna kolejność wstawiania tabel tenanta — rodzice przed dziećmi, żeby
 * klucze obce trzymały. Wyprowadzona z migracji `packages/db/supabase/migrations/*`
 * (stan na 2026-08-24). Pogrupowana w warstwy zależności; w obrębie warstwy kolejność
 * jest obojętna dla FK.
 *
 * `scope`:
 *   "tenant"   — dane należące do najemcy, odtwarzane per-tenant (filtr `tenant_id`).
 *   "child"    — wiersze zależne od encji tenanta (FK do products/orders/sites/…).
 *   "platform" — tabele WSPÓŁDZIELONE/globalne; NIE odtwarza się ich per-tenant
 *                (byłyby już na miejscu po odtworzeniu schematu/danych platformy).
 *
 * TODO(I5.6): zweryfikować względem finalnego grafu FK eksportu; tabela spoza tej
 * listy w manifeście jest RAPORTOWANA (patrz `classifyTables`), nie wstawiana na ślepo.
 */
const CANONICAL_RESTORE_ORDER = [
  // — warstwa 1: korzeń i singletony tenanta —
  { table: "tenants", tier: 1, scope: "tenant", note: "korzeń — wszystko poniżej ma FK tenant_id" },
  { table: "tenant_settings", tier: 1, scope: "tenant" },
  { table: "tenant_secrets", tier: 1, scope: "tenant", note: "SEKRETY — koperty AES-256-GCM (patrz sekcja secrets)" },
  { table: "members", tier: 1, scope: "tenant", note: "wymaga wcześniejszego odtworzenia auth.users (GoTrue)" },
  { table: "payment_accounts", tier: 1, scope: "tenant", note: "konto Stripe Connect najemcy (referencja do konta u dostawcy)" },
  { table: "subscriptions", tier: 1, scope: "tenant", note: "subskrypcja platformy najemcy" },

  // — warstwa 2: katalog i konfiguracja (FK → tenant) —
  { table: "catalog_categories", tier: 2, scope: "tenant" },
  { table: "custom_field_definitions", tier: 2, scope: "tenant" },
  { table: "pickup_locations", tier: 2, scope: "tenant" },
  { table: "products", tier: 2, scope: "tenant" },
  { table: "pricing_tiers", tier: 2, scope: "child", note: "FK → products/tenant" },

  // — warstwa 3: dzieci produktów —
  { table: "product_units", tier: 3, scope: "child", note: "egzemplarze — FK → products" },
  { table: "product_categories", tier: 3, scope: "child", note: "M:N products × catalog_categories" },
  { table: "product_images", tier: 3, scope: "child", note: "metadane; pliki w storage (patrz storage)" },
  { table: "product_image_uploads", tier: 3, scope: "child" },
  { table: "product_slug_history", tier: 3, scope: "child" },

  // — warstwa 4: klienci —
  { table: "customers", tier: 4, scope: "tenant" },
  { table: "customer_bans", tier: 4, scope: "child", note: "FK → customers" },

  // — warstwa 5: zamówienia i ich dzieci —
  { table: "orders", tier: 5, scope: "tenant", note: "FK → customers (opcjonalnie)" },
  { table: "order_items", tier: 5, scope: "child", note: "FK → orders, product_units — blokady egzemplarzy" },
  { table: "order_notes", tier: 5, scope: "child", note: "FK → orders" },
  { table: "deposit_events", tier: 5, scope: "child", note: "FK → orders — dziennik kaucji" },
  { table: "deposit_refunds", tier: 5, scope: "child", note: "FK → orders/deposit_events" },
  { table: "courier_shipments", tier: 5, scope: "child", note: "FK → orders — przesyłki kurierskie" },
  { table: "contract_documents", tier: 5, scope: "child", note: "FK → orders/tenant — umowy najmu" },

  // — warstwa 6: strony i domeny —
  { table: "sites", tier: 6, scope: "tenant", note: "witryna sklepu (kreator)" },
  { table: "site_sections", tier: 6, scope: "child", note: "FK → sites" },
  { table: "site_image_uploads", tier: 6, scope: "child" },
  { table: "site_slug_history", tier: 6, scope: "child" },
  { table: "domains", tier: 6, scope: "tenant", note: "rejestracja domeny w Vercelu — patrz zależności infra" },

  // — warstwa 7: dokumenty prawne —
  { table: "legal_documents", tier: 7, scope: "tenant" },
  { table: "legal_document_versions", tier: 7, scope: "child", note: "FK → legal_documents" },
  { table: "platform_terms_acceptances", tier: 7, scope: "tenant", note: "akceptacje regulaminu platformy przez najemcę" },

  // — warstwa 8: API i integracje —
  { table: "api_keys", tier: 8, scope: "tenant", note: "klucze API najemcy (wtyczka WP)" },
  { table: "invitations", tier: 8, scope: "tenant" },
  { table: "webhook_events", tier: 8, scope: "tenant", note: "idempotencja webhooków — zwykle NIE trzeba odtwarzać" },

  // — warstwa 9: dzienniki / liczniki (append-only, najmniej krytyczne) —
  { table: "audit_log", tier: 9, scope: "tenant" },
  { table: "email_logs", tier: 9, scope: "tenant" },
  { table: "account_email_logs", tier: 9, scope: "tenant" },
  { table: "usage_counters", tier: 9, scope: "tenant" },
  { table: "rate_limit_counters", tier: 9, scope: "tenant", note: "efemeryczne — pomijalne przy odtwarzaniu" },
  { table: "review_comments", tier: 9, scope: "tenant" },
  { table: "review_comment_attachments", tier: 9, scope: "child", note: "FK → review_comments" },
];

/** Tabele współdzielone/globalne — nie należą do eksportu per-najemca. */
const PLATFORM_SHARED_TABLES = new Set([
  "plans", // katalog planów platformy (globalny)
  "platform_terms_versions", // wersje regulaminu platformy (globalne)
  "waitlist_signups", // zlikwidowane; nie dotyczy pojedynczego najemcy
]);

const KNOWN_TABLES = new Set(CANONICAL_RESTORE_ORDER.map((entry) => entry.table));

const HELP = `Szkielet DR — punktowe odtwarzanie JEDNEGO najemcy z manifestu eksportu (I5.7).

UŻYCIE
  node scripts/dr/restore-tenant.mjs --dry-run <manifest.json>   Wypisz plan (bez zapisu).
  node scripts/dr/restore-tenant.mjs --example                   Wypisz wzorcowy manifest.
  node scripts/dr/restore-tenant.mjs --help                      Ta pomoc.

FLAGI
  --dry-run   Domyślne i JEDYNE wykonalne. Czyta manifest z dysku, wypisuje plan.
  --execute   ZAGWOŻDŻONE. Rzuca błędem — realne odtwarzanie wymaga backupu/PITR i
              depozytu klucza (decyzje właściciela, B4). Patrz runbook-dr-avably.md.
  --example   Wypisuje na stdout wzorcowy manifest w oczekiwanym kształcie.

GRANICE
  ZERO sieci, ZERO produkcji, ZERO zapisu. Wyłącznie odczyt lokalnego pliku manifestu.
`;

/** Wzorcowy manifest — do dema dry-run i jako referencja kształtu. TODO(I5.6): dopiąć. */
function exampleManifest() {
  return {
    manifestVersion: EXPECTED_MANIFEST_VERSION,
    exportedAt: "2026-08-24T21:00:00.000Z",
    tenant: {
      id: "00000000-0000-0000-0000-0000000000aa",
      slug: "przykladowa-wypozyczalnia",
      name: "Przykładowa Wypożyczalnia",
    },
    source: {
      supabaseProject: "<projekt-supabase>",
      schemaMigration: "0103", // najwyższa migracja objęta eksportem
    },
    tables: [
      { name: "tenants", file: "data/tenants.jsonl", rowCount: 1 },
      { name: "tenant_settings", file: "data/tenant_settings.jsonl", rowCount: 1 },
      { name: "members", file: "data/members.jsonl", rowCount: 2 },
      { name: "catalog_categories", file: "data/catalog_categories.jsonl", rowCount: 6 },
      { name: "products", file: "data/products.jsonl", rowCount: 48 },
      { name: "product_units", file: "data/product_units.jsonl", rowCount: 132 },
      { name: "product_categories", file: "data/product_categories.jsonl", rowCount: 71 },
      { name: "customers", file: "data/customers.jsonl", rowCount: 210 },
      { name: "orders", file: "data/orders.jsonl", rowCount: 640 },
      { name: "order_items", file: "data/order_items.jsonl", rowCount: 1580 },
      { name: "sites", file: "data/sites.jsonl", rowCount: 1 },
      { name: "site_sections", file: "data/site_sections.jsonl", rowCount: 9 },
      { name: "domains", file: "data/domains.jsonl", rowCount: 1 },
    ],
    secrets: {
      file: "data/tenant_secrets.jsonl",
      rowCount: 3,
      encrypted: true,
      envelopeFormat: "v1:<wersja>:<iv>:<tag>:<ct>", // AES-256-GCM (ADR-052)
      keyVersions: [1],
      // Koperty są ZWIĄZANE z (tenant_id, key) jako AAD — nie da się ich przenieść
      // do innego wiersza. Odszyfrowanie wymaga AVABLY_SECRETS_KEY_V<wersja> ze środowiska.
      requiresEnv: ["AVABLY_SECRETS_KEY_CURRENT", "AVABLY_SECRETS_KEY_V1"],
    },
    storage: [
      { bucket: "product-images", prefix: "tenant/<id>/", objectCount: 96 },
      { bucket: "site-images", prefix: "tenant/<id>/", objectCount: 12 },
    ],
  };
}

/** Rzuca `DrManifestError` z czytelnym komunikatem, gdy warunek nie zachodzi. */
class DrManifestError extends Error {
  constructor(/** @type {string} */ message) {
    super(message);
    this.name = "DrManifestError";
  }
}

/** Waliduje MINIMALNY kształt manifestu potrzebny do zbudowania planu. */
function validateManifest(/** @type {any} */ manifest, /** @type {string} */ sourcePath) {
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new DrManifestError(`manifest ${sourcePath} nie jest obiektem JSON`);
  }
  if (typeof manifest.manifestVersion !== "string") {
    throw new DrManifestError("brak pola `manifestVersion` (string)");
  }
  if (manifest.manifestVersion !== EXPECTED_MANIFEST_VERSION) {
    // Ostrzeżenie, nie błąd — szkielet ma przeżyć drobny drift wersji do czasu I5.6.
    stderr.write(
      `UWAGA: manifestVersion="${manifest.manifestVersion}", szkielet oczekuje ` +
        `"${EXPECTED_MANIFEST_VERSION}". TODO(I5.6): dopiąć do finalnego formatu.\n`,
    );
  }
  const tenant = manifest.tenant;
  if (!tenant || typeof tenant.id !== "string" || tenant.id.length === 0) {
    throw new DrManifestError("brak `tenant.id` — nie wiadomo, którego najemcę odtwarzać");
  }
  if (!Array.isArray(manifest.tables)) {
    throw new DrManifestError("pole `tables` musi być tablicą");
  }
  for (const [index, entry] of manifest.tables.entries()) {
    if (!entry || typeof entry.name !== "string") {
      throw new DrManifestError(`tables[${index}] bez pola \`name\``);
    }
    if (entry.rowCount != null && typeof entry.rowCount !== "number") {
      throw new DrManifestError(`tables[${index}].rowCount, jeśli podane, musi być liczbą`);
    }
  }
  return manifest;
}

/**
 * Dzieli tabele z manifestu na trzy kubełki i porządkuje ODTWARZALNE wg kolejności
 * kanonicznej. Tabele spoza listy kanonicznej są RAPORTOWANE, nie porządkowane na ślepo.
 */
function classifyTables(/** @type {any} */ manifest) {
  const byName = new Map(manifest.tables.map((/** @type {any} */ t) => [t.name, t]));

  const ordered = CANONICAL_RESTORE_ORDER.filter((entry) => byName.has(entry.table)).map((entry) => ({
    ...entry,
    rowCount: byName.get(entry.table)?.rowCount ?? null,
  }));

  const platformShared = manifest.tables
    .filter((/** @type {any} */ t) => PLATFORM_SHARED_TABLES.has(t.name))
    .map((/** @type {any} */ t) => t.name);

  const unknown = manifest.tables
    .filter((/** @type {any} */ t) => !KNOWN_TABLES.has(t.name) && !PLATFORM_SHARED_TABLES.has(t.name))
    .map((/** @type {any} */ t) => t.name);

  return { ordered, platformShared, unknown };
}

/** Wypisuje czytelny PLAN odtworzenia. Wyłącznie tekst — żadnych mutacji. */
function printPlan(/** @type {any} */ manifest, /** @type {string} */ sourcePath) {
  const { ordered, platformShared, unknown } = classifyTables(manifest);
  const totalRows = ordered.reduce((sum, e) => sum + (e.rowCount ?? 0), 0);

  const out = [];
  out.push("═".repeat(72));
  out.push("PLAN ODTWORZENIA NAJEMCY (DRY-RUN — bez zapisu, bez sieci, bez produkcji)");
  out.push("═".repeat(72));
  out.push(`Manifest:   ${basename(sourcePath)}`);
  out.push(`Najemca:    ${manifest.tenant.name ?? "—"}  [${manifest.tenant.id}]`);
  if (manifest.tenant.slug) out.push(`Slug:       ${manifest.tenant.slug}`);
  if (manifest.exportedAt) out.push(`Eksport z:  ${manifest.exportedAt}`);
  if (manifest.source?.schemaMigration) {
    out.push(`Schemat:    migracja ${manifest.source.schemaMigration} (odtwórz PRZED danymi)`);
  }
  out.push("");

  out.push("KOLEJNOŚĆ 0 — SCHEMAT (poza tym skryptem):");
  out.push("  Odtwórz schemat z migracji `packages/db/supabase/migrations/*` do wersji");
  out.push(`  ${manifest.source?.schemaMigration ?? "<z manifestu>"} PRZED wstawianiem danych. Bez tego FK/RLS nie istnieją.`);
  out.push("");

  out.push(`KOLEJNOŚĆ WSTAWIANIA DANYCH (${ordered.length} tabel, ~${totalRows} rekordów):`);
  let currentTier = 0;
  for (const entry of ordered) {
    if (entry.tier !== currentTier) {
      currentTier = entry.tier;
      out.push(`  ── warstwa ${currentTier} ──`);
    }
    const rows = entry.rowCount == null ? "?" : String(entry.rowCount);
    const marker = entry.scope === "child" ? "└─" : "•";
    const note = entry.note ? `   ← ${entry.note}` : "";
    out.push(`  ${marker} ${entry.table.padEnd(28)} ${rows.padStart(6)} rek.${note}`);
  }
  out.push("");

  // Sekcja sekretów — najczęstszy pojedynczy punkt awarii przy DR.
  if (manifest.secrets) {
    const s = manifest.secrets;
    out.push("SEKRETY NAJEMCY (tenant_secrets):");
    out.push(`  Wierszy:      ${s.rowCount ?? "?"}  (${s.encrypted ? "zaszyfrowane" : "JAWNE — anomalia!"})`);
    out.push(`  Format:       ${s.envelopeFormat ?? "v1:<wersja>:<iv>:<tag>:<ct> (AES-256-GCM, ADR-052)"}`);
    out.push(`  Wersje klucza: ${(s.keyVersions ?? []).join(", ") || "?"}`);
    out.push("  ODSZYFROWANIE wymaga klucza(y) ze ŚRODOWISKA (NIE z bazy):");
    for (const env of s.requiresEnv ?? ["AVABLY_SECRETS_KEY_CURRENT", "AVABLY_SECRETS_KEY_V1"]) {
      out.push(`    - ${env}`);
    }
    out.push("  Bez klucza koperty są NIEODWRACALNIE nieczytelne (fail-closed, AAD=tenant_id:key).");
    out.push("  → depozyt klucza poza bazą to DECYZJA WŁAŚCICIELA (I5.4/ADR-052, B4).");
    out.push("");
  }

  // Pliki w storage — poza bazą, osobny nośnik.
  if (Array.isArray(manifest.storage) && manifest.storage.length > 0) {
    out.push("PLIKI W STORAGE (poza bazą — Supabase Storage):");
    for (const bucket of manifest.storage) {
      out.push(`  • ${bucket.bucket}  prefiks ${bucket.prefix}  (~${bucket.objectCount ?? "?"} obiektów)`);
    }
    out.push("  → przywrócić PO metadanych (product_images/site_image_uploads wskazują ścieżki).");
    out.push("");
  }

  if (platformShared.length > 0) {
    out.push("POMINIĘTE — tabele współdzielone/globalne (NIE per-najemca):");
    out.push(`  ${platformShared.join(", ")}`);
    out.push("");
  }

  if (unknown.length > 0) {
    out.push("⚠ TABELE SPOZA LISTY KANONICZNEJ (nie uporządkowano — wymaga przeglądu):");
    out.push(`  ${unknown.join(", ")}`);
    out.push("  → TODO(I5.6): dopisać do CANONICAL_RESTORE_ORDER z właściwą warstwą FK.");
    out.push("");
  }

  out.push("WERYFIKACJA PO ODTWORZENIU (patrz docs/operacje/runbook-dr-avably.md):");
  out.push("  1. Izolacja RLS: zalogowany najemca widzi WYŁĄCZNIE swoje wiersze.");
  out.push("  2. Spójność FK: brak osieroconych order_items / product_units.");
  out.push("  3. Sekrety: próbne odszyfrowanie 1 koperty kluczem ze środowiska.");
  out.push("  4. Storage: metadane obrazów mają pokrycie w obiektach bucketa.");
  out.push("");
  out.push("DRY-RUN ZAKOŃCZONY. Nic nie zapisano. Realne odtwarzanie: patrz --execute (zagwożdżone).");
  out.push("═".repeat(72));

  stdout.write(out.join("\n") + "\n");
}

/** Zagwożdżona ścieżka realnego wykonania — świadomie niezaimplementowana. */
function refuseExecute() {
  throw new Error(
    "Realne odtwarzanie NIE jest zaimplementowane (I5.7). Wymaga: (a) gotowego backupu/" +
      "PITR (decyzja B4), (b) depozytu klucza szyfrującego sekrety poza bazą (I5.4/ADR-052), " +
      "(c) jawnego potwierdzenia operatora. Dopóki te fundamenty nie są ustalone przez " +
      "właściciela, skrypt działa WYŁĄCZNIE w trybie --dry-run. Patrz docs/operacje/runbook-dr-avably.md.",
  );
}

function main() {
  const { values, positionals } = parseArgs({
    args: argv.slice(2),
    options: {
      "dry-run": { type: "boolean", default: false },
      execute: { type: "boolean", default: false },
      example: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    stdout.write(HELP);
    return 0;
  }

  if (values.example) {
    stdout.write(JSON.stringify(exampleManifest(), null, 2) + "\n");
    return 0;
  }

  // Realne wykonanie jest zagwożdżone niezależnie od dry-run.
  if (values.execute) {
    refuseExecute();
  }

  const manifestPath = positionals[0];
  if (!manifestPath) {
    stderr.write("Błąd: podaj ścieżkę do manifestu.\n\n" + HELP);
    return 2;
  }

  // Domyślnie dry-run; jawny --dry-run też akceptowany. To JEDYNY wykonalny tryb.
  let raw;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch (error) {
    stderr.write(`Błąd: nie udało się odczytać manifestu "${manifestPath}": ${error.message}\n`);
    return 2;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    stderr.write(`Błąd: manifest "${manifestPath}" nie jest poprawnym JSON: ${error.message}\n`);
    return 2;
  }

  const manifest = validateManifest(parsed, manifestPath);
  printPlan(manifest, manifestPath);
  return 0;
}

try {
  exit(main());
} catch (error) {
  stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
  exit(1);
}
