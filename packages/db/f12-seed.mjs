// Seed tenanta weryfikacyjnego F12 (belka mobilna — czytelność).
// Odtwarza warunki ze zrzutu właściciela:
//   • ZNAK FIRMY o proporcjach 4:1 (typowy plik wypożyczalni) — to on rysował
//     się na ~20 px wysokości, bo slot znaku był wygłodzony przez pigułkę;
//   • KATEGORIE (wyzwalacz w belce ma się w ogóle pojawić);
//   • KATALOG z pozycjami (kafle na /katalog);
//   • termin do pigułki ustawia przeglądarka (localStorage koszyka).
// Wzorzec: scratchpad/f11-seed-tenant.mjs. Idempotentny (kasuje slug).
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");

const SLUG = "f12-belka";
const url = process.env.SUPABASE_LOCAL_API_URL;
const key = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Ustaw SUPABASE_LOCAL_API_URL i SUPABASE_LOCAL_SERVICE_ROLE_KEY");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

async function insert(table, row) {
  const { error } = await admin.from(table).insert(row);
  if (error) throw new Error(`${table}: ${error.message}`);
}
async function insertReturningId(table, row) {
  const { data, error } = await admin.from(table).insert(row).select("id").single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data.id;
}

{
  const { data } = await admin.from("tenants").select("id").eq("slug", SLUG);
  for (const t of data ?? []) await admin.from("tenants").delete().eq("id", t.id);
}

const tenantId = await insertReturningId("tenants", {
  slug: SLUG,
  // Nazwa DŁUGA — druga strona sporu o pas belki: gdy znaku brak, to ona
  // dobija do wielokropka. Ta sama, co u właściciela na produkcji.
  name: "Wypożyczalnia Sprzętu Budowlanego",
  status: "active",
});

// --- ZNAK FIRMY 4:1 --------------------------------------------------------
const uploadId = randomUUID();
const logoPath = `${tenantId}/logo/${uploadId}.png`;
{
  const bytes = readFileSync(process.env.F12_LOGO_PATH ?? "/tmp/f12-logo-4x1.png");
  const { error } = await admin.storage
    .from("site-images")
    .upload(logoPath, bytes, { contentType: "image/png", upsert: true });
  if (error) throw new Error(`storage: ${error.message}`);
  const { error: updateError } = await admin
    .from("tenants")
    .update({
      logo_draft: { path: logoPath, alt: "Wypożyczalnia Sprzętu Budowlanego", inFooter: true },
      logo_published: { path: logoPath, alt: "Wypożyczalnia Sprzętu Budowlanego", inFooter: true },
    })
    .eq("id", tenantId);
  if (updateError) throw new Error(`logo_published: ${updateError.message}`);
}

const ownerEmail = `f12-owner-${Date.now()}@example.com`;
const created = await admin.auth.admin.createUser({
  email: ownerEmail,
  password: "F12Test!12345678",
  email_confirm: true,
  app_metadata: { tenant_id: tenantId, role: "owner" },
});
if (created.error || !created.data.user) throw new Error(`GoTrue: ${created.error?.message}`);
await insert("members", { tenant_id: tenantId, user_id: created.data.user.id, role: "owner" });

const KATEGORIE = [
  ["Agregaty", "agregaty"],
  ["Zagęszczarki", "zageszczarki"],
  ["Rusztowania", "rusztowania"],
  ["Podnośniki", "podnosniki"],
  ["Nagrzewnice", "nagrzewnice"],
  ["Kosiarki", "kosiarki"],
];
const categoryIds = {};
for (let i = 0; i < KATEGORIE.length; i += 1) {
  const [name, slug] = KATEGORIE[i];
  categoryIds[slug] = await insertReturningId("catalog_categories", {
    tenant_id: tenantId,
    name,
    slug,
    position: i,
  });
}

const PRODUCTS = [
  ["Agregat prądotwórczy 8 kVA", 10_000, "agregaty"],
  ["Agregat cichy 3 kVA", 24_000, "agregaty"],
  ["Nagrzewnica gazowa 20 kW", 26_000, "nagrzewnice"],
  ["Zagęszczarka gruntu 200 kg", 45_000, "zageszczarki"],
  ["Podnośnik nożycowy 10 m", 78_000, "podnosniki"],
  ["Kosiarka bijakowa", 31_000, "kosiarki"],
];
for (const [name, price, kat] of PRODUCTS) {
  const productId = await insertReturningId("products", {
    tenant_id: tenantId,
    name,
    description: `${name} — sprzęt z katalogu weryfikacyjnego F12.`,
    base_price_day_grosze: price,
    deposit_grosze: price * 3,
    buffer_before_days: 0,
    buffer_after_days: 0,
    active: true,
  });
  await insert("product_categories", {
    tenant_id: tenantId,
    product_id: productId,
    category_id: categoryIds[kat],
  });
  for (let i = 1; i <= 2; i += 1) {
    await insert("product_units", {
      tenant_id: tenantId,
      product_id: productId,
      serial_number: `F12-${price}-${i}`,
    });
  }
}

await insert("pickup_locations", {
  tenant_id: tenantId,
  name: "Magazyn główny",
  address_street: "Magazynowa 17",
  address_zip: "80-001",
  address_city: "Gdańsk",
  active: true,
});

async function stronaZSekcjami(slug, name, sekcje) {
  const siteId = await insertReturningId("sites", {
    tenant_id: tenantId,
    template: "classic",
    template_published: "classic",
    slug,
    slug_published: slug,
    published_at: new Date().toISOString(),
    name,
  });
  for (let i = 0; i < sekcje.length; i += 1) {
    const [type, content] = sekcje[i];
    await insert("site_sections", {
      tenant_id: tenantId,
      site_id: siteId,
      type,
      position: i,
      enabled: true,
      content_draft: content,
      content_published: content,
      position_published: i,
      enabled_published: true,
    });
  }
  return siteId;
}

await stronaZSekcjami("", "Strona główna F12", [
  [
    "hero",
    {
      heading: "Wypożycz sprzęt bez papierologii",
      subheading: "Rezerwacja online, odbiór na miejscu albo z dostawą.",
    },
  ],
  ["products", { heading: "Nasz sprzęt" }],
]);

console.log(
  JSON.stringify(
    { tenantId, slug: SLUG, logoPath, kategorie: KATEGORIE.length, produkty: PRODUCTS.length },
    null,
    2,
  ),
);
