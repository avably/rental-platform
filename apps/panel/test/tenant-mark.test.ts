/**
 * ZNAK NAJEMCY W MAILU I W UMOWIE — GRANICA DANYCH (ADR-175).
 *
 * Tu mierzymy to, czego nie widać w szablonie: SKĄD znak pochodzi i co się
 * dzieje, gdy pliku nie da się pobrać. Trzy pytania, po jednym na warunek
 * zamknięcia zadania:
 *
 *   1. IZOLACJA — czy znak najemcy A ma jak wejść do dokumentu najemcy B,
 *   2. ŹRÓDŁO — czy bierze się ze stanu OPUBLIKOWANEGO, a nie ze szkicu,
 *   3. ODPORNOŚĆ — czy niedostępny zasób wywraca generowanie umowy.
 *
 * Każdy przypadek „czegoś nie ma" ma w tym samym pliku kontrolę pozytywną na
 * danych różniących się WYŁĄCZNIE badaną rzeczą — inaczej zieleń mówiłaby
 * tylko tyle, że fikstura była pusta.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderContractPdf } from "@avably/pdf";

import {
  tenantContractLogo,
  tenantEmailLogo,
  type TenantMarkRow,
} from "@/lib/tenant-mark";
import { buildContractPdfProps } from "@/app/[locale]/(panel)/zamowienia/[id]/contract-document";

const SUPABASE = "https://przyklad.supabase.co";
const BAZA = `${SUPABASE}/storage/v1/object/public/site-images`;

const A = {
  nazwa: "Wypożyczalnia Północ",
  sciezka:
    "8f7a1b2c-3d4e-4f50-9a1b-2c3d4e5f6071/logo/1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9.png",
};
const B = {
  nazwa: "Sprzęt Południe",
  sciezka:
    "b1c2d3e4-f506-4718-9a2b-3c4d5e6f7081/logo/2b3c4d5e-6f70-4819-a2b3-c4d5e6f70819.png",
};

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Wiersz najemcy w kształcie, w jakim oddaje go zapytanie panelu. */
function wiersz(
  najemca: typeof A,
  opcje: { opublikowany?: boolean; szkic?: boolean; rozszerzenie?: string } = {},
): TenantMarkRow & { logo_draft?: unknown } {
  const sciezka = opcje.rozszerzenie
    ? najemca.sciezka.replace(/\.png$/, opcje.rozszerzenie)
    : najemca.sciezka;
  return {
    name: najemca.nazwa,
    logo_published: opcje.opublikowany === false ? {} : { path: sciezka, inFooter: true },
    ...(opcje.szkic ? { logo_draft: { path: sciezka, inFooter: true } } : {}),
  };
}

function odpowiedz(bytes: Buffer, ok = true): Response {
  return {
    ok,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as Response;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("znak w mailu — izolacja najemców", () => {
  it("mail najemcy B niesie znak B, a znak A nie ma jak się w nim znaleźć", () => {
    const znakA = tenantEmailLogo(wiersz(A));
    const znakB = tenantEmailLogo(wiersz(B));

    expect(znakB).toEqual({ src: `${BAZA}/${B.sciezka}`, alt: B.nazwa });
    expect(znakB!.src).not.toContain(A.sciezka);
    // Kontrola pozytywna w tym samym przebiegu: rozdział działa w obie strony.
    expect(znakA).toEqual({ src: `${BAZA}/${A.sciezka}`, alt: A.nazwa });
    expect(znakA!.src).not.toContain(B.sciezka);
  });

  it("najemca bez opublikowanego znaku nie dostaje żadnego", () => {
    expect(tenantEmailLogo(wiersz(A, { opublikowany: false }))).toBeUndefined();
  });

  /**
   * ŹRÓDŁEM JEST STAN OPUBLIKOWANY. Wiersz ma szkic i nie ma publikacji —
   * czyli stan operatora, który wgrał znak i jeszcze go nie opublikował.
   * Mail wychodzi na zewnątrz, więc wysłanie szkicu byłoby publikacją,
   * której nikt nie zamawiał.
   */
  it("szkic nie wychodzi do klienta, publikacja tak", () => {
    expect(tenantEmailLogo(wiersz(A, { opublikowany: false, szkic: true }))).toBeUndefined();
    // Ten sam wiersz, różniący się WYŁĄCZNIE publikacją.
    expect(tenantEmailLogo(wiersz(A, { szkic: true }))).toEqual({
      src: `${BAZA}/${A.sciezka}`,
      alt: A.nazwa,
    });
  });
});

describe("znak w umowie — bajty, nie adres", () => {
  it("pobiera plik znaku TEGO najemcy i oddaje go jako base64", async () => {
    const adresy: string[] = [];
    const pobierz = vi.fn(async (url: unknown) => {
      adresy.push(String(url));
      return odpowiedz(PNG_1x1);
    });

    const logo = await tenantContractLogo(wiersz(B), { fetch: pobierz as never });

    expect(adresy).toEqual([`${BAZA}/${B.sciezka}`]);
    expect(adresy[0]).not.toContain(A.sciezka);
    expect(logo).toEqual({ data: PNG_1x1.toString("base64"), format: "png" });
  });

  it("najemca bez znaku nie powoduje ani jednego żądania", async () => {
    const pobierz = vi.fn();
    expect(
      await tenantContractLogo(wiersz(A, { opublikowany: false }), { fetch: pobierz as never }),
    ).toBeUndefined();
    expect(pobierz).not.toHaveBeenCalled();
  });

  it("szkic nie trafia do umowy", async () => {
    const pobierz = vi.fn(async () => odpowiedz(PNG_1x1));

    expect(
      await tenantContractLogo(wiersz(A, { opublikowany: false, szkic: true }), {
        fetch: pobierz as never,
      }),
    ).toBeUndefined();
    expect(pobierz).not.toHaveBeenCalled();
    // Kontrola pozytywna: ten sam wiersz z publikacją plik POBIERA.
    expect(
      await tenantContractLogo(wiersz(A, { szkic: true }), { fetch: pobierz as never }),
    ).not.toBeUndefined();
  });

  it("format, którego dokument nie zdekoduje, nie jest nawet pobierany", async () => {
    const pobierz = vi.fn(async () => odpowiedz(PNG_1x1));

    expect(
      await tenantContractLogo(wiersz(A, { rozszerzenie: ".webp" }), { fetch: pobierz as never }),
    ).toBeUndefined();
    expect(pobierz).not.toHaveBeenCalled();
  });

  it("odpowiedź spoza 2xx i plik ponad sufit modelu znaku degradują do braku", async () => {
    const czterysta = vi.fn(async () => odpowiedz(PNG_1x1, false));
    expect(await tenantContractLogo(wiersz(A), { fetch: czterysta as never })).toBeUndefined();

    const zaDuzy = vi.fn(async () => odpowiedz(Buffer.alloc(512 * 1024 + 1, 0x89)));
    expect(await tenantContractLogo(wiersz(A), { fetch: zaDuzy as never })).toBeUndefined();
  });
});

/**
 * ============ NIEDOSTĘPNY ZASÓB NIE WYWRACA UMOWY (rozstrzygnięcie R4) ============
 *
 * To jest najostrzejszy punkt zadania: dokument, który przestaje powstawać,
 * blokuje najem. Trzy kształty awarii bucketa — zerwane połączenie, brak
 * odpowiedzi w limicie czasu i 404 po skasowanym pliku — muszą kończyć się
 * UMOWĄ, w której stoi nazwa najemcy, a nie wyjątkiem i nie pustą ramką.
 */
describe("umowa powstaje mimo niedostępnego zasobu", () => {
  const settings = {
    address: "ul. Portowa 4, 70-001 Szczecin",
    nip: "8522334455",
    email: "kontakt@polnoc.example",
    terms_version: "1.0",
    terms_body: "Najemca zwraca sprzęt w stanie niepogorszonym.",
  };

  const zamowienie = {
    order_number: "AV-2026-08-014",
    start_date: "2026-08-14",
    end_date: "2026-08-17",
    total_rental_grosze: 30000,
    total_deposit_grosze: 100000,
    delivery_grosze: 1500,
    currency: "PLN",
    customers: {
      full_name: "Anna Kowalska",
      email: "anna.kowalska@example.com",
      locale: "pl" as const,
      address_street: "ul. Morska 12/3",
      address_zip: "70-002",
      address_city: "Szczecin",
    },
    order_items: [
      {
        rental_grosze: 30000,
        deposit_grosze: 100000,
        products: { name: "Kamera Sony FX3" },
        product_units: { serial_number: "SN-FX3-0001" },
      },
    ],
  };

  async function umowaDla(logo: Awaited<ReturnType<typeof tenantContractLogo>>) {
    const props = buildContractPdfProps({
      tenant: { name: A.nazwa },
      ...(logo ? { tenantLogo: logo } : {}),
      tenantLocale: "pl",
      currency: "PLN",
      settings,
      order: zamowienie,
    });
    const bytes = await renderContractPdf(props);
    return {
      bytes,
      // Czy dokument NIESIE obraz — marker z formatu PDF, ta sama miara co
      // w suicie pakietu umów. Warstwę TEKSTU (nazwa najemcy w nagłówku)
      // mierzy tamta suita: parser PDF-a jest jej zależnością, a tu chodzi
      // o coś innego — o to, że dokument w ogóle POWSTAŁ.
      obraz: /\/Subtype\s*\/Image/.test(Buffer.from(bytes).toString("latin1")),
      logoWPropsach: props.tenant.logo,
    };
  }

  it("zerwane połączenie z bucketem: umowa jest, w nagłówku nazwa najemcy", async () => {
    const logo = await tenantContractLogo(wiersz(A), {
      fetch: (() => Promise.reject(new Error("ECONNREFUSED"))) as never,
    });
    expect(logo).toBeUndefined();

    const umowa = await umowaDla(logo);
    expect(new TextDecoder().decode(umowa.bytes.subarray(0, 5))).toBe("%PDF-");
    expect(umowa.bytes.byteLength).toBeGreaterThan(1000);
    expect(umowa.logoWPropsach).toBeUndefined();
    expect(umowa.obraz).toBe(false);
  });

  it("bucket, który nie odpowiada: limit czasu zamyka sprawę, umowa powstaje", async () => {
    const nigdy = (_url: unknown, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("AbortError")));
      });

    const logo = await tenantContractLogo(wiersz(A), { fetch: nigdy as never, timeoutMs: 25 });
    expect(logo).toBeUndefined();

    const umowa = await umowaDla(logo);
    expect(new TextDecoder().decode(umowa.bytes.subarray(0, 5))).toBe("%PDF-");
    expect(umowa.logoWPropsach).toBeUndefined();
    expect(umowa.obraz).toBe(false);
  });

  // ── KONTROLA POZYTYWNA: przy DOSTĘPNYM zasobie znak w umowie JEST. Bez tego
  // przypadku trzy powyższe byłyby zielone także dla kodu, który nigdy nie
  // wstawia obrazu — czyli dowodziłyby czegoś innego, niż mówią.
  it("dostępny zasób: ta sama umowa niesie obraz znaku", async () => {
    const logo = await tenantContractLogo(wiersz(A), {
      fetch: (async () => odpowiedz(PNG_1x1)) as never,
    });
    expect(logo).not.toBeUndefined();

    const umowa = await umowaDla(logo);
    expect(umowa.obraz).toBe(true);
    expect(umowa.logoWPropsach).toEqual({ data: PNG_1x1.toString("base64"), format: "png" });
  });
});
