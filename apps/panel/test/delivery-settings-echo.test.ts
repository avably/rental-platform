import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ECHO WPISANYCH WARTOŚCI I JEGO GRANICE (U9, audyt UX 6.1) — warstwa AKCJI.
 *
 * ================== CO TU JEST DOWODZONE ==================
 *
 * 1. Nieudany zapis ODDAJE operatorowi to, co wpisał (`FormState.values`).
 *    Bez tego pełny obieg dokumentu odtwarza formularz ze stanu bazy i kasuje
 *    jego pracę — a obieg dokumentu zdarza się zawsze, gdy strona nie zdążyła
 *    się zhydratować.
 * 2. Echo NIE NIESIE HASŁA KURIERA. Pole jest tylko do zapisu (ADR-052):
 *    aplikacja nie czyta go nawet z bazy, więc tym bardziej nie ma prawa odbić
 *    go z powrotem do HTML-a. To jest sonda bezpieczeństwa tej paczki.
 * 3. Pusty wynik upsertu (polityka USING odfiltrowała wiersz — członek bez
 *    uprawnień właściciela) NIE JEST sukcesem. Chip „zapisano" bierze się
 *    wyłącznie z `state.success`, więc dowód, że `success` zostaje pusty, jest
 *    dowodem, że chip nie zapala się po odmowie RLS.
 *
 * Bez Supabase i bez sieci: klient jest szpiegiem, jak w `custom-fields-actions`.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";
/** Wartość, której NIE WOLNO znaleźć w stanie akcji ani w renderze. */
const COURIER_PASSWORD = "tajne-haslo-kuriera-9f3b";

function makeSupabase(result: { data: unknown; error: unknown }) {
  const calls = { from: [] as string[], upserts: [] as Record<string, unknown>[] };
  const builder: Record<string, unknown> = {
    upsert(payload: Record<string, unknown>) {
      calls.upserts.push(payload);
      return builder;
    },
    select() {
      return Promise.resolve(result);
    },
  };
  return {
    calls,
    supabase: {
      from(table: string) {
        calls.from.push(table);
        return builder;
      },
    },
  };
}

const requireMember = vi.fn();
vi.mock("@/lib/supabase-server", () => ({ requireMember: () => requireMember() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const {
  saveCourierCredentialsAction,
  saveCourierParcelAction,
  saveCourierSenderAction,
  saveDeliveryPricingAction,
} = await import("@/app/[locale]/(panel)/ustawienia-dostaw/delivery-settings-actions");

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

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

beforeEach(() => {
  requireMember.mockReset();
});

describe("echo po nieudanym zapisie — praca operatora wraca na ekran", () => {
  it("cennik z błędną kwotą oddaje WSZYSTKIE wpisane wartości, nie tylko poprawne", async () => {
    const state = await saveDeliveryPricingAction(
      {},
      form({
        courierPrice: "abc",
        courierFreeAbove: "500",
        parcelLockerPrice: "16,99",
        parcelLockerFreeAbove: "",
        ownDeliveryPrice: "39,99",
        ownDeliveryFreeAbove: "800",
      }),
    );

    // Najpierw: błąd naprawdę jest i siedzi PRZY POLU (inaczej asercja niżej
    // dowodziłaby czegoś o ścieżce sukcesu).
    expect(state.fieldErrors?.courierPrice).toBe("Nieprawidłowa kwota.");
    expect(state.success).toBeUndefined();

    expect(state.values).toEqual({
      courierPrice: "abc",
      courierFreeAbove: "500",
      parcelLockerPrice: "16,99",
      parcelLockerFreeAbove: "",
      ownDeliveryPrice: "39,99",
      ownDeliveryFreeAbove: "800",
    });
  });

  it("paczka z wartością spoza zakresu oddaje wpisane wymiary", async () => {
    const state = await saveCourierParcelAction(
      {},
      form({ lengthCm: "40", widthCm: "30", heightCm: "20", weightKg: "9999" }),
    );

    expect(state.fieldErrors?.weightKg).toBeTruthy();
    expect(state.values?.lengthCm).toBe("40");
    expect(state.values?.weightKg).toBe("9999");
  });

  it("echo zostaje także przy ODMOWIE bazy, nie tylko przy błędzie walidacji", async () => {
    const { supabase } = makeSupabase({ data: null, error: { code: "42501", message: "denied" } });
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const state = await saveCourierSenderAction({}, form({ ...VALID_SENDER, city: "Gdańsk" }));

    expect(state.formError).toContain("właściciel");
    expect(state.values?.city, "odmowa RLS skasowała pracę operatora").toBe("Gdańsk");
  });

  it("udany zapis NIE odbija wejścia — ekran czyta prawdę z bazy", async () => {
    const { supabase } = makeSupabase({ data: [{ key: "courier_sender" }], error: null });
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const state = await saveCourierSenderAction({}, form(VALID_SENDER));

    expect(state.success).toBe("courier_sender");
    expect(state.values).toBeUndefined();
  });
});

describe("SONDA BEZPIECZEŃSTWA: echo nie wynosi hasła kuriera", () => {
  it("odrzucone credentiale oddają e-mail i środowisko, ale NIGDY hasła", async () => {
    const state = await saveCourierCredentialsAction(
      {},
      form({
        email: "nie-jest-adresem",
        password: COURIER_PASSWORD,
        environment: "production",
      }),
    );

    // Kontrola pozytywna: echo w ogóle powstało i coś w nim jest — inaczej
    // „nie ma hasła" byłoby prawdą o pustym zbiorze.
    expect(state.fieldErrors?.email).toBeTruthy();
    expect(state.values?.email).toBe("nie-jest-adresem");
    expect(state.values?.environment).toBe("production");

    expect(state.values?.password).toBeUndefined();
    expect(
      JSON.stringify(state),
      "hasło kuriera wyciekło do stanu formularza",
    ).not.toContain(COURIER_PASSWORD);
  });

  it("nazwy pól tylko do zapisu są WSPÓLNE, nie pamiętane przez formularz", async () => {
    const { WRITE_ONLY_FIELD_NAMES, formEcho } = await import("@/lib/form-state");

    expect(WRITE_ONLY_FIELD_NAMES).toContain("password");
    expect(formEcho({ email: "a@example.invalid", password: COURIER_PASSWORD })).toEqual({
      email: "a@example.invalid",
    });
  });
});

describe("gotowość sekcji = TA SAMA ocena, którą dostaje nadanie przesyłki", () => {
  const CREDENTIALS = {
    key: "globkurier_credentials",
    value: { email: "integracja@example.invalid", environment: "test" },
  };
  const SENDER = {
    key: "courier_sender",
    value: {
      name: "Fikcyjna Wypożyczalnia",
      street: "Przykładowa",
      house_number: "10",
      post_code: "00-001",
      city: "Przykładowo",
      phone: "+48 000 000 000",
      email: "wysylka@example.invalid",
    },
  };
  const PARCEL = {
    key: "courier_parcel",
    value: { length_cm: 40, width_cm: 30, height_cm: 20, weight_kg: 5 },
  };
  const PRICING = {
    key: "delivery_pricing",
    value: { courier: { price_grosze: 2499 } },
  };

  it("komplet ustawień z zapisanym hasłem daje cztery sekcje gotowe", async () => {
    const { deliverySectionStates } = await import(
      "@/app/[locale]/(panel)/ustawienia-dostaw/delivery-settings-status"
    );

    expect(deliverySectionStates([CREDENTIALS, SENDER, PARCEL, PRICING], true)).toEqual({
      credentials: "complete",
      sender: "complete",
      parcel: "complete",
      pricing: "complete",
    });
  });

  it("brak HASŁA gasi kartę konta integracji, nie ruszając pozostałych", async () => {
    const { deliverySectionStates } = await import(
      "@/app/[locale]/(panel)/ustawienia-dostaw/delivery-settings-status"
    );

    // To jest sedno „jednej oceny": wiersz ustawień istnieje, więc naiwne
    // sprawdzenie obecności klucza powiedziałoby „gotowe" — a nadanie przesyłki
    // i tak by się nie udało, bo hasła nie ma (ADR-052).
    expect(deliverySectionStates([CREDENTIALS, SENDER, PARCEL, PRICING], false)).toEqual({
      credentials: "incomplete",
      sender: "complete",
      parcel: "complete",
      pricing: "complete",
    });
  });

  it("wadliwe wymiary paczki są brakiem, a nie gotowością", async () => {
    const { deliverySectionStates } = await import(
      "@/app/[locale]/(panel)/ustawienia-dostaw/delivery-settings-status"
    );

    const broken = { key: "courier_parcel", value: { length_cm: 0, width_cm: 30 } };
    const states = deliverySectionStates([CREDENTIALS, SENDER, broken, PRICING], true);
    expect(states.parcel).toBe("incomplete");
    expect(states.sender).toBe("complete");
  });

  it("pusty cennik to sekcja niekompletna — sklep nie policzy dostawy", async () => {
    const { deliverySectionStates } = await import(
      "@/app/[locale]/(panel)/ustawienia-dostaw/delivery-settings-status"
    );

    expect(deliverySectionStates([CREDENTIALS, SENDER, PARCEL], true).pricing).toBe("incomplete");
    expect(
      deliverySectionStates([CREDENTIALS, SENDER, PARCEL, { key: "delivery_pricing", value: {} }], true)
        .pricing,
    ).toBe("incomplete");
  });
});

describe("SONDA IZOLACJI: pusty wynik po RLS nie udaje sukcesu", () => {
  it("upsert bez ani jednego wiersza daje odmowę, a nie „zapisano”", async () => {
    // Polityka USING odfiltrowała wiersz: PostgREST nie zgłasza błędu, tylko
    // oddaje pustą listę. To jest ODMOWA — członek zespołu bez uprawnień
    // właściciela nie ma prawa zobaczyć chipa „Zapisano.".
    const { supabase, calls } = makeSupabase({ data: [], error: null });
    requireMember.mockResolvedValue({ supabase, tenantId: TENANT });

    const state = await saveCourierSenderAction({}, form(VALID_SENDER));

    expect(calls.from, "akcja nawet nie sięgnęła do tabeli").toContain("tenant_settings");
    expect(state.success, "zero wierszy zapaliło chip „zapisano”").toBeUndefined();
    expect(state.formError).toBe(
      "Ustawienia dostaw może zmieniać wyłącznie właściciel konta.",
    );
    // I nawet przy odmowie operator nie traci wpisanych danych.
    expect(state.values?.name).toBe(VALID_SENDER.name);
  });
});
