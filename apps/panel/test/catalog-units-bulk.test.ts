/**
 * ZBIORCZY ZAPIS EGZEMPLARZY — SONDA UPRAWNIEŃ I ODMÓW (U8b, ADR-146)
 * na żywym, lokalnym Supabase.
 *
 * Refaktor „N formularzy → jeden zapis" ma jedno realne ryzyko i ono jest tu
 * badane: ZGUBIENIE ODMOWY. DELETE na `product_units` jest w RLS
 * OWNER-ONLY (0007) i przy braku uprawnień NIE zgłasza błędu — dosięga zero
 * wierszy. Dopóki każde usunięcie miało własny przycisk i własny komunikat,
 * cisza była widoczna; jedno „Zapisano" nad całą tabelą przykryłoby ją
 * idealnie. Druga mina to `order_items_unit_fk` BEZ `ON DELETE`: usunięcie
 * egzemplarza wiszącego na zamówieniu leci 23503, a operator ma zobaczyć
 * zdanie po polsku, nie nazwę więzu.
 *
 * Akcja jedzie DROGĄ PRODUKCYJNĄ: realny `saveUnitsAction`, realne schematy,
 * realne RLS. Podstawiony jest wyłącznie `requireMember` — bo w teście nie ma
 * ciasteczek żądania — i oddaje ŻYWEGO klienta z sesją owner albo staff.
 * Rola nie jest tu deklaracją: klient staffa ma claim `role: "staff"`, więc
 * `app.is_tenant_owner()` w polityce odpowiada NIE.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import { rpcCreateTenant } from "./helpers/create-tenant";
import { integrationEnv } from "./helpers/integration-env";

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const TEST_PASSWORD = "CatalogUnits!12345678";

const authContext = vi.hoisted(() => ({
  current: null as { supabase: unknown; tenantId: string; role: string } | null,
}));

vi.mock("@/lib/supabase-server", () => ({
  requireMember: async () => {
    if (!authContext.current) throw new Error("Sonda nie ustawiła kontekstu uwierzytelnienia.");
    return authContext.current;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { saveUnitsAction } = await import(
  "@/app/[locale]/(panel)/katalog/[id]/egzemplarze/actions"
);

const createdUserIds: string[] = [];
const createdTenantIds: string[] = [];

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

function createAdminClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  return client;
}

/** Wiersz edytora tak, jak serializuje go `units-editor.tsx`. */
interface EditorRow {
  id: string | null;
  serialNumber: string;
  unavailableFrom: string;
  unavailableTo: string;
  unavailableReason: string;
}

const row = (id: string | null, serialNumber: string, extra: Partial<EditorRow> = {}): EditorRow => ({
  id,
  serialNumber,
  unavailableFrom: "",
  unavailableTo: "",
  unavailableReason: "",
  ...extra,
});

function unitsForm(rows: EditorRow[], removedUnitIds: string[] = []): FormData {
  const form = new FormData();
  form.set("units", JSON.stringify(rows));
  form.set("removedUnitIds", JSON.stringify(removedUnitIds));
  return form;
}

describe.skipIf(!hasEnv)("zbiorczy zapis egzemplarzy — uprawnienia i odmowy (U8b)", () => {
  let admin: SupabaseClient;
  let ownerClient: SupabaseClient;
  let staffClient: SupabaseClient;
  let tenantId: string;
  let productId: string;

  /** Egzemplarze zasiane na starcie: [wolny, wolny, na zamówieniu]. */
  let unitIds: string[] = [];

  const asOwner = () => {
    authContext.current = { supabase: ownerClient, tenantId, role: "owner" };
  };
  const asStaff = () => {
    authContext.current = { supabase: staffClient, tenantId, role: "staff" };
  };

  async function readUnits(): Promise<{ id: string; serial_number: string | null }[]> {
    const { data } = await admin
      .from("product_units")
      .select("id, serial_number")
      .eq("product_id", productId)
      .order("created_at", { ascending: true });
    return (data ?? []) as { id: string; serial_number: string | null }[];
  }

  beforeAll(async () => {
    admin = createAdminClient();

    const ownerEmail = `units-owner-${randomUUID()}@test.local`;
    const { data: owner, error: ownerError } = await admin.auth.admin.createUser({
      email: ownerEmail,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (ownerError || !owner.user) throw new Error(`createUser(owner): ${ownerError?.message}`);
    createdUserIds.push(owner.user.id);

    const bootstrap = await signIn(ownerEmail);
    const { data: created, error: tenantError } = await rpcCreateTenant(bootstrap, {
      p_slug: `units-${randomUUID()}`.slice(0, 39),
      p_name: "Organizacja egzemplarzy",
    });
    if (tenantError) throw new Error(`create_tenant: ${tenantError.message}`);
    tenantId = created as string;
    createdTenantIds.push(tenantId);
    ownerClient = await signIn(ownerEmail);

    // Staff w TYM SAMYM tenancie (wzorzec export-csv.test.ts): członkostwo
    // w tabeli + claim w app_metadata, bo polityki czytają claim.
    const staffEmail = `units-staff-${randomUUID()}@test.local`;
    const { data: staff, error: staffError } = await admin.auth.admin.createUser({
      email: staffEmail,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (staffError || !staff.user) throw new Error(`createUser(staff): ${staffError?.message}`);
    createdUserIds.push(staff.user.id);
    const { error: memberError } = await admin
      .from("members")
      .insert({ tenant_id: tenantId, user_id: staff.user.id, role: "staff" });
    if (memberError) throw new Error(`insert members(staff): ${memberError.message}`);
    await admin.auth.admin.updateUserById(staff.user.id, {
      app_metadata: { tenant_id: tenantId, role: "staff" },
    });
    staffClient = await signIn(staffEmail);

    const { data: product, error: productError } = await admin
      .from("products")
      .insert({
        tenant_id: tenantId,
        name: "Podnośnik nożycowy",
        base_price_day_grosze: 30_000,
        deposit_grosze: 100_000,
        auto_increment_multiplier: 1.0,
      })
      .select("id")
      .single();
    if (productError) throw new Error(`insert products: ${productError.message}`);
    productId = product!.id as string;

    for (const serial of ["SN-1", "SN-2", "SN-NA-ZAMOWIENIU"]) {
      const { data: unit, error } = await admin
        .from("product_units")
        .insert({ tenant_id: tenantId, product_id: productId, serial_number: serial })
        .select("id")
        .single();
      if (error) throw new Error(`insert product_units(${serial}): ${error.message}`);
      unitIds.push(unit!.id as string);
    }

    // Trzeci egzemplarz wisi na zamówieniu — `order_items_unit_fk` nie ma
    // `ON DELETE`, więc baza obroni się przed jego usunięciem błędem 23503.
    const { data: customer } = await admin
      .from("customers")
      .insert({ tenant_id: tenantId, email: `k-${randomUUID()}@test.local` })
      .select("id")
      .single();
    const { data: order } = await admin
      .from("orders")
      .insert({
        tenant_id: tenantId,
        customer_id: customer!.id,
        start_date: "2026-08-10",
        end_date: "2026-08-12",
        delivery_method: "courier",
        total_rental_grosze: 30_000,
      })
      .select("id")
      .single();
    const { error: itemError } = await admin.from("order_items").insert({
      tenant_id: tenantId,
      order_id: order!.id,
      product_id: productId,
      unit_id: unitIds[2]!,
      rental_grosze: 30_000,
    });
    if (itemError) throw new Error(`insert order_items: ${itemError.message}`);
  }, 180_000);

  afterAll(async () => {
    if (!hasEnv) return;
    authContext.current = null;
    if (createdTenantIds.length > 0) {
      await admin.from("tenants").delete().in("id", createdTenantIds);
    }
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
    createdUserIds.length = 0;
    createdTenantIds.length = 0;
    unitIds = [];
  }, 60_000);

  it("kontrola pozytywna: produkt ma trzy egzemplarze, jeden na zamówieniu", async () => {
    // Bez tego wszystkie dowody niżej mogłyby przejść po pustym zbiorze.
    expect(await readUnits()).toHaveLength(3);
    const { data: items } = await admin
      .from("order_items")
      .select("unit_id")
      .eq("unit_id", unitIds[2]!);
    expect(items).toHaveLength(1);
  });

  it("staff zapisuje CAŁĄ tabelę jednym submitem", async () => {
    asStaff();
    const result = await saveUnitsAction(
      productId,
      {},
      unitsForm([
        row(unitIds[0]!, "SN-1-POPRAWIONY"),
        row(unitIds[1]!, "SN-2", {
          unavailableFrom: "2026-09-01",
          unavailableTo: "2026-09-03",
          unavailableReason: "przegląd",
        }),
        row(unitIds[2]!, "SN-NA-ZAMOWIENIU"),
        row(null, "SN-NOWY"),
      ]),
    );

    expect(result).toEqual({ success: "saved" });
    const units = await readUnits();
    expect(units.map((unit) => unit.serial_number)).toEqual([
      "SN-1-POPRAWIONY",
      "SN-2",
      "SN-NA-ZAMOWIENIU",
      "SN-NOWY",
    ]);
    const serviced = units.find((unit) => unit.id === unitIds[1]!)!;
    const { data: window } = await admin
      .from("product_units")
      .select("unavailable_from, unavailable_to, unavailable_reason")
      .eq("id", serviced.id)
      .single();
    expect(window).toEqual({
      unavailable_from: "2026-09-01",
      unavailable_to: "2026-09-03",
      unavailable_reason: "przegląd",
    });
  });

  it("USUNIĘCIE PRZEZ STAFFA NIE GINIE PO CICHU — zapisy zostają, odmowa jest widoczna", async () => {
    asStaff();
    const before = await readUnits();
    const newUnit = before.find((unit) => unit.serial_number === "SN-NOWY")!;

    const result = await saveUnitsAction(
      productId,
      {},
      unitsForm(
        [
          row(unitIds[0]!, "SN-1-PO-STAFFIE"),
          row(unitIds[1]!, "SN-2"),
          row(unitIds[2]!, "SN-NA-ZAMOWIENIU"),
        ],
        [newUnit.id],
      ),
    );

    // 1. WYNIK NIE JEST SUKCESEM. To jest sedno: gdyby akcja oddała
    //    { success: "saved" }, operator zobaczyłby zieloną linijkę nad
    //    tabelą, w której egzemplarz nadal stoi.
    expect(result.success).toBeUndefined();
    expect(result.formError, "odmowa usunięcia nie dotarła do operatora").toBeTruthy();
    // 2. Komunikat WSKAZUJE egzemplarz i mówi, czego zabrakło.
    expect(result.formError).toContain("SN-NOWY");
    expect(result.formError).toContain("właściciela");
    // 3. …i mówi wprost, że reszta ZOSTAŁA zapisana — inaczej operator
    //    wpisałby poprawki drugi raz.
    expect(result.formError).toContain("Zapisano zmiany");

    const after = await readUnits();
    // Egzemplarz NADAL istnieje (odmowa RLS), a poprawka pola weszła.
    expect(after.map((unit) => unit.serial_number)).toContain("SN-NOWY");
    expect(after.find((unit) => unit.id === unitIds[0]!)!.serial_number).toBe("SN-1-PO-STAFFIE");
  });

  it("właściciel usuwa ten sam egzemplarz bez przeszkód", async () => {
    asOwner();
    const before = await readUnits();
    const newUnit = before.find((unit) => unit.serial_number === "SN-NOWY")!;

    const result = await saveUnitsAction(
      productId,
      {},
      unitsForm(
        [
          row(unitIds[0]!, "SN-1-PO-STAFFIE"),
          row(unitIds[1]!, "SN-2"),
          row(unitIds[2]!, "SN-NA-ZAMOWIENIU"),
        ],
        [newUnit.id],
      ),
    );

    expect(result).toEqual({ success: "saved" });
    expect((await readUnits()).map((unit) => unit.serial_number)).not.toContain("SN-NOWY");
  });

  it("egzemplarz na zamówieniu odmawia PO POLSKU, nie nazwą więzu (23503)", async () => {
    asOwner();
    const result = await saveUnitsAction(
      productId,
      {},
      unitsForm([row(unitIds[0]!, "SN-1-PO-STAFFIE"), row(unitIds[1]!, "SN-2")], [unitIds[2]!]),
    );

    expect(result.success).toBeUndefined();
    expect(result.formError).toContain("SN-NA-ZAMOWIENIU");
    expect(result.formError).toContain("przypisany do zamówienia");
    // Surowy komunikat bazy NIE dociera do operatora.
    expect(result.formError).not.toContain("order_items_unit_fk");
    expect(result.formError).not.toContain("violates");

    // Egzemplarz przeżył — baza broni historii przed dziurą.
    expect((await readUnits()).map((unit) => unit.id)).toContain(unitIds[2]!);
  });

  it("duplikat numeru seryjnego zatrzymuje się PRZED bazą i wskazuje powód", async () => {
    asOwner();
    const result = await saveUnitsAction(
      productId,
      {},
      unitsForm([
        row(unitIds[0]!, "TAKI-SAM"),
        row(unitIds[1]!, "TAKI-SAM"),
        row(unitIds[2]!, "SN-NA-ZAMOWIENIU"),
      ]),
    );

    expect(result.formError).toContain("ten sam numer seryjny");
    // Nic się nie zapisało — walidacja poprzedza pierwsze dotknięcie bazy.
    expect((await readUnits()).map((unit) => unit.serial_number)).not.toContain("TAKI-SAM");
  });

  it("okno serwisowe bez drugiej daty wskazuje NUMER WIERSZA", async () => {
    asOwner();
    const result = await saveUnitsAction(
      productId,
      {},
      unitsForm([
        row(unitIds[0]!, "SN-1-PO-STAFFIE"),
        row(unitIds[1]!, "SN-2", { unavailableFrom: "2026-09-01" }),
      ]),
    );

    expect(result.formError).toContain("Egzemplarz nr 2");
    expect(result.formError).toContain("OBU dat");
  });

  it("ten sam egzemplarz w zapisie i w usunięciu jest odrzucany, nie zgadywany", async () => {
    asOwner();
    const result = await saveUnitsAction(
      productId,
      {},
      unitsForm([row(unitIds[0]!, "SN-1-PO-STAFFIE")], [unitIds[0]!]),
    );

    expect(result.formError).toContain("jednocześnie zapisywany i usuwany");
    expect((await readUnits()).map((unit) => unit.id)).toContain(unitIds[0]!);
  });

  it("cudzy identyfikator egzemplarza nie dosięga niczego", async () => {
    asOwner();
    const foreignId = randomUUID();
    const result = await saveUnitsAction(
      productId,
      {},
      unitsForm([row(foreignId, "PODSTAWIONY")], []),
    );

    // UPDATE zawężony po tenancie i produkcie nie dosięga wiersza — akcja
    // mówi to wprost, zamiast oddać ciche „zapisano".
    expect(result.success).toBeUndefined();
    expect(result.formError).toContain("już nie istnieje");
    expect((await readUnits()).map((unit) => unit.serial_number)).not.toContain("PODSTAWIONY");
  });
});
