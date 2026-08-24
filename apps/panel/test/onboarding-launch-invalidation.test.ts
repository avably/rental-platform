/**
 * KORELACJA INWALIDACJI cache sygnałów uruchomienia (ADR-261).
 *
 * Cache huba trzyma się, dopóki mutacja panelu nie powie „to nieaktualne".
 * Ten plik dowodzi, że mówią to DOKŁADNIE mutacje zmieniające sygnał, a nie
 * pierwsza lepsza akcja tej samej powierzchni:
 *
 *   RELATED (emitują `revalidateTag("launch:<tenant>", "max")`):
 *     • createProductAction   — pierwszy produkt / produkt aktywny;
 *     • publishLegalDocumentAction — publikacja regulaminu/polityki;
 *     • saveDeliveryPricingAction  — cennik dostaw;
 *     • publishSite               — publikacja strony sklepu.
 *
 *   UNRELATED (NIE emitują tagu — kontrast w TYM SAMYM pliku akcji):
 *     • saveLegalDocumentDraftAction — zapis SZKICU (żywej wersji nie rusza);
 *     • saveCourierSenderAction      — nadawca kuriera (nie cennik).
 *
 * DOWÓD MUTACYJNY: usunięcie `revalidateLaunchSignals(...)` z którejkolwiek akcji
 * RELATED pali jej `toHaveBeenCalledWith` niżej. Dodanie go do którejkolwiek
 * UNRELATED pali `not.toHaveBeenCalled`.
 *
 * Test jest CZYSTY (fałszywy Supabase, bez env) — wzorem catalog-actions /
 * legal-documents-actions / delivery-settings-echo. `next/cache` zamockowany
 * ze szpiegiem `revalidateTag`; klucz to argument, którym akcja go woła.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidateTag = vi.fn();
const revalidatePath = vi.fn();
const requireMember = vi.fn();
const redirect = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath, revalidateTag }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/navigation", () => ({ localePath: async (p: string) => p }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("@/lib/supabase-server", () => ({ requireMember: () => requireMember() }));
// Zależności okołoproduktowe: ich kontrakty mają własne suity — tutaj mają tylko
// przepuścić `createProductAction` do punktu, w którym woła revalidateLaunchSignals.
vi.mock("@/lib/custom-fields-server", () => ({
  readCustomFieldsForCreate: async () => ({ values: {}, fieldErrors: {} }),
  readCustomFieldsForUpdate: async () => ({ values: {}, fieldErrors: {} }),
}));
vi.mock("@/lib/catalog/categories", () => ({ syncProductCategories: async () => null }));

const { launchCacheTag } = await import("@/lib/onboarding/launch");
const { createProductAction } = await import("@/app/[locale]/(panel)/katalog/actions");
const { publishLegalDocumentAction, saveLegalDocumentDraftAction } = await import(
  "@/app/[locale]/(panel)/dokumenty-prawne/actions"
);
const { saveDeliveryPricingAction, saveCourierSenderAction } = await import(
  "@/app/[locale]/(panel)/ustawienia-dostaw/delivery-settings-actions"
);
const { publishSite } = await import("@/lib/actions/site");

const TENANT = "11111111-1111-4111-8111-111111111111";
const SITE = "33333333-3333-4333-8333-333333333333";
const LAUNCH_TAG = launchCacheTag(TENANT);

function thenable<T>(result: T) {
  return { then: (resolve: (v: T) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject) };
}

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

/** Supabase dla `createProductAction`: insert produktu oddaje id. */
function productSupabase() {
  return {
    from(table: string) {
      if (table === "products") {
        return {
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: "p1" }, error: null }) }) }),
        };
      }
      throw new Error(`product fake: nieoczekiwana tabela ${table}`);
    },
  };
}

/** Supabase dla akcji legaliów: upsert szkicu + RPC publikacji. */
function legalSupabase() {
  return {
    from(table: string) {
      if (table === "legal_documents") {
        return { upsert: () => ({ select: () => thenable({ data: [{ id: "doc-1" }], error: null }) }) };
      }
      if (table === "tenant_settings") {
        const chain: Record<string, unknown> = {};
        chain.eq = () => chain;
        chain.maybeSingle = async () => ({ data: null, error: null });
        return { select: () => chain };
      }
      throw new Error(`legal fake: nieoczekiwana tabela ${table}`);
    },
    schema: () => ({
      rpc: async () => ({ data: { version_label: "2026-08", created: true }, error: null }),
    }),
  };
}

/** Supabase dla ustawień dostaw: upsert klucza tenant_settings przechodzi. */
function deliverySupabase() {
  return {
    from(table: string) {
      if (table === "tenant_settings") {
        return { upsert: () => ({ select: () => thenable({ data: [{ key: "ok" }], error: null }) }) };
      }
      throw new Error(`delivery fake: nieoczekiwana tabela ${table}`);
    },
  };
}

/** Supabase dla `publishSite`: obie RPC schematu `app` przechodzą. */
function siteSupabase() {
  return {
    schema: () => ({
      rpc: async (fn: string) =>
        fn === "publish_site"
          ? { data: "2026-08-01T10:00:00Z", error: null }
          : { data: null, error: null },
    }),
  };
}

const VALID_PRODUCT = {
  name: "Wiertarka",
  description: "",
  basePriceDayGrosze: "120,00",
  depositGrosze: "300,00",
  autoIncrementMultiplier: "1,5",
  bufferBeforeDays: "0",
  bufferAfterDays: "0",
  minRentalDays: "2",
  active: "on",
};

const VALID_PRICING = {
  courierPrice: "19,99",
  courierFreeAbove: "500",
  parcelLockerPrice: "16,99",
  parcelLockerFreeAbove: "",
  ownDeliveryPrice: "39,99",
  ownDeliveryFreeAbove: "800",
};

const VALID_SENDER = {
  name: "Fikcyjna Wypożyczalnia",
  street: "Przykładowa",
  houseNumber: "10",
  apartmentNumber: "2",
  postCode: "00-001",
  city: "Przykładowo",
  phone: "+48 000 000 000",
  email: "wysylka@example.invalid",
};

const VALID_DRAFT = {
  kind: "privacy",
  title: "Polityka prywatności",
  body_draft: "Fikcyjna treść polityki prywatności.",
  locale: "pl",
};

function actAs(supabase: unknown) {
  requireMember.mockResolvedValue({ supabase, tenantId: TENANT });
}

beforeEach(() => {
  revalidateTag.mockClear();
  revalidatePath.mockClear();
  requireMember.mockReset();
  redirect.mockClear();
});

describe("mutacje ZMIENIAJĄCE sygnał inwalidują cache huba (ADR-261)", () => {
  it("createProductAction → revalidateTag('launch:<tenant>')", async () => {
    actAs(productSupabase());
    await createProductAction({}, form(VALID_PRODUCT));
    expect(revalidateTag).toHaveBeenCalledWith(LAUNCH_TAG, "max");
  });

  it("publishLegalDocumentAction → revalidateTag('launch:<tenant>')", async () => {
    actAs(legalSupabase());
    const result = await publishLegalDocumentAction("terms");
    expect(result.ok, result.ok ? "" : result.error).toBe(true);
    expect(revalidateTag).toHaveBeenCalledWith(LAUNCH_TAG, "max");
  });

  it("saveDeliveryPricingAction → revalidateTag('launch:<tenant>')", async () => {
    actAs(deliverySupabase());
    const state = await saveDeliveryPricingAction({}, form(VALID_PRICING));
    expect(state.success, state.formError ?? "").toBe("delivery_pricing");
    expect(revalidateTag).toHaveBeenCalledWith(LAUNCH_TAG, "max");
  });

  it("publishSite → revalidateTag('launch:<tenant>')", async () => {
    actAs(siteSupabase());
    const result = await publishSite(SITE);
    expect(result.ok, result.ok ? "" : result.error).toBe(true);
    expect(revalidateTag).toHaveBeenCalledWith(LAUNCH_TAG, "max");
  });
});

describe("mutacje NIEZWIĄZANE z sygnałem NIE inwalidują cache huba", () => {
  it("saveLegalDocumentDraftAction (szkic) NIE woła tagu launch", async () => {
    actAs(legalSupabase());
    const state = await saveLegalDocumentDraftAction({}, form(VALID_DRAFT));
    expect(state.success, state.formError ?? "").toBe("privacy");
    expect(revalidateTag).not.toHaveBeenCalledWith(LAUNCH_TAG, "max");
  });

  it("saveCourierSenderAction (nadawca, nie cennik) NIE woła tagu launch", async () => {
    actAs(deliverySupabase());
    const state = await saveCourierSenderAction({}, form(VALID_SENDER));
    expect(state.success, state.formError ?? "").toBe("courier_sender");
    expect(revalidateTag).not.toHaveBeenCalledWith(LAUNCH_TAG, "max");
  });
});
