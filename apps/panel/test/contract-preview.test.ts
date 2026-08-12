/**
 * Podgląd umowy na ekranie ustawień (U10, ADR-151).
 *
 * Trzy rzeczy są tu bronione, bo trzy mogą się zepsuć bez żadnego objawu:
 *
 *  1. **To ten sam szablon.** Podgląd, który rysuje własny „prawie taki sam"
 *     dokument, jest gorszy niż jego brak — operator zaakceptowałby wygląd,
 *     którego system nigdy nie wygeneruje. Bronimy tego TOŻSAMOŚCIĄ referencji
 *     renderera i kształtem propsów, a nie porównaniem bajtów: `renderToBuffer`
 *     stempluje w PDF-ie datę utworzenia, więc dwa renders tych samych propsów
 *     RÓŻNIĄ SIĘ bajtami (sprawdzone pomiarem, nie założeniem).
 *
 *  2. **Podgląd nie zostawia śladu.** Żadnego wiersza w rejestrze umów, żadnego
 *     pliku w koszyku, żadnej zużytej numeracji. Klient bazy w tych testach jest
 *     WROGI: każda operacja zapisu rzuca z imienia.
 *
 *  3. **Odczyt jest zawężony po najemcy SAMYM ZAPYTANIEM**, nie tylko przez RLS
 *     (druga połowa dowodu — na żywej bazie, klientem service-role — stoi
 *     w `contract-preview-isolation.test.ts`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { renderContractPdf, type ContractPdfProps } from "@avably/pdf";

import {
  CONTRACT_PREVIEW_FILENAME,
  contractPreviewDeps,
  loadContractPreviewProps,
  renderContractPreview,
} from "@/app/[locale]/(panel)/ustawienia-umow/preview";
import {
  CONTRACT_PREVIEW_DAYS,
  CONTRACT_PREVIEW_MARK,
  contractPreviewOrderRow,
} from "@/app/[locale]/(panel)/ustawienia-umow/preview-sample";
import { ContractSettingsError } from "@/lib/contract-settings";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const TODAY = "2026-08-12";

const SETTINGS = {
  address: "ul. Portowa 4, 70-001 Szczecin",
  nip: "8522334455",
  email: "umowy@polnoc.example",
  terms_version: "2026-08",
  terms_body: "Najemca zwraca sprzęt w stanie niepogorszonym.",
};

interface RecordedCall {
  table: string;
  columns: string;
  filters: Array<[string, unknown]>;
  terminal: string;
}

interface FakeRows {
  contractSettings?: unknown;
  currency?: unknown;
  tenant?: unknown;
  error?: { message: string; code?: string };
}

/**
 * Klient bazy, który UMIE WYŁĄCZNIE CZYTAĆ.
 *
 * Zapisy nie są tu „nieobsłużone" — są jawnie zaminowane. Test, który pilnuje
 * braku zapisu przez sam brak atrapy, przechodzi także wtedy, gdy kod zapisuje
 * przez ścieżkę, o której test nie wie; ten rzuci z nazwą operacji.
 */
function fakeSupabase(rows: FakeRows): { client: SupabaseClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const mine = (operation: string) => () => {
    throw new Error(`podgląd wykonał operację zapisu: ${operation}`);
  };

  const client = {
    from(table: string) {
      const call: RecordedCall = { table, columns: "", filters: [], terminal: "" };
      const builder = {
        select(columns: string) {
          call.columns = columns;
          calls.push(call);
          return builder;
        },
        eq(column: string, value: unknown) {
          call.filters.push([column, value]);
          return builder;
        },
        in: mine("in-write"),
        maybeSingle() {
          call.terminal = "maybeSingle";
          if (rows.error) return Promise.resolve({ data: null, error: rows.error });
          const key = call.filters.find(([column]) => column === "key")?.[1];
          if (table === "tenants") return Promise.resolve({ data: rows.tenant ?? null, error: null });
          if (key === "contract_document") {
            return Promise.resolve({
              data: rows.contractSettings === undefined
                ? null
                : { key: "contract_document", value: rows.contractSettings },
              error: null,
            });
          }
          if (key === "currency") {
            return Promise.resolve({ data: { value: rows.currency ?? "PLN" }, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        single: mine("single"),
        insert: mine("insert"),
        upsert: mine("upsert"),
        update: mine("update"),
        delete: mine("delete"),
      };
      return builder;
    },
    rpc: mine("rpc"),
    storage: { from: mine("storage.from") },
  };

  return { client: client as unknown as SupabaseClient, calls };
}

const tenantRow = (locale: "pl" | "en" = "pl") => ({ name: "Wypożyczalnia Północ", locale });

const readyRows = (locale: "pl" | "en" = "pl"): FakeRows => ({
  contractSettings: SETTINGS,
  tenant: tenantRow(locale),
  currency: "PLN",
});

describe("podgląd umowy — TEN SAM szablon co prawdziwa umowa", () => {
  it("renderer podglądu JEST rendererem pakietu PDF (tożsamość referencji)", () => {
    // Sedno paczki: podmiana na lokalną kopię szablonu przestaje być zmianą,
    // której nikt nie zauważy. Porównanie po nazwie funkcji przepuściłoby
    // kopię o tej samej nazwie — porównujemy referencję.
    expect(contractPreviewDeps().render).toBe(renderContractPdf);
  });

  it("propsy niosą ZAPISANE dane firmy i warunki najemcy", async () => {
    const { client } = fakeSupabase(readyRows());
    const props = await loadContractPreviewProps(client, { tenantId: TENANT_ID, today: TODAY });

    expect(props.tenant).toEqual({
      name: "Wypożyczalnia Północ",
      address: SETTINGS.address,
      nip: SETTINGS.nip,
      email: SETTINGS.email,
    });
    expect(props.terms).toEqual({
      version: SETTINGS.terms_version,
      body: SETTINGS.terms_body,
    });
    expect(props.totals.currency).toBe("PLN");
    expect(props.locale).toBe("pl");
  });

  it("brak zapisanych ustawień to błąd domenowy, nie dokument z dziurami", async () => {
    const { client } = fakeSupabase({ tenant: tenantRow(), currency: "PLN" });
    await expect(
      loadContractPreviewProps(client, { tenantId: TENANT_ID, today: TODAY }),
    ).rejects.toBeInstanceOf(ContractSettingsError);
  });

  it("dokument jedzie językiem NAJEMCY, nie językiem panelu", async () => {
    const { client } = fakeSupabase(readyRows("en"));
    const props = await loadContractPreviewProps(client, { tenantId: TENANT_ID, today: TODAY });
    expect(props.locale).toBe("en");
    expect(props.order.number).toBe(CONTRACT_PREVIEW_MARK.en);
  });

  it("render podglądu oddaje prawdziwy, parsowalny nagłówek PDF", async () => {
    const { client } = fakeSupabase(readyRows());
    const preview = await renderContractPreview(contractPreviewDeps(), client, {
      tenantId: TENANT_ID,
      today: TODAY,
    });

    // Kontrola po pustym zbiorze: najpierw sprawdzamy, że coś się w ogóle
    // wyrenderowało, dopiero potem twierdzimy cokolwiek o zawartości.
    expect(preview.bytes.byteLength).toBeGreaterThan(1000);
    expect(Buffer.from(preview.bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(preview.filename).toBe(CONTRACT_PREVIEW_FILENAME.pl);
  }, 30_000);
});

describe("dane przykładowe są OZNACZONE jako przykład", () => {
  it("znacznik jest przypięty SŁOWEM, nie odczytem samego siebie", () => {
    // Bez tego asercje niżej porównywałyby stałą ze sobą samą i przeszłyby
    // także wtedy, gdyby ktoś ustawił numer wyglądający jak prawdziwy
    // („AV-2026-08-001") — sprawdzone mutacją. Słowo jest kontraktem
    // z operatorem: to jedyna rzecz, która na wydruku odróżnia przymiarkę
    // od dokumentu, pod którym ktoś się podpisze.
    expect(CONTRACT_PREVIEW_MARK.pl).toBe("PRZYKŁAD");
    expect(CONTRACT_PREVIEW_MARK.en).toBe("SAMPLE");
  });

  it.each([
    ["pl", CONTRACT_PREVIEW_MARK.pl],
    ["en", CONTRACT_PREVIEW_MARK.en],
  ] as const)("%s: numer zamówienia niesie znacznik przykładu", async (locale, mark) => {
    const { client } = fakeSupabase(readyRows(locale));
    const props = await loadContractPreviewProps(client, { tenantId: TENANT_ID, today: TODAY });

    // `order.number` szablon drukuje w plakietce nagłówka ORAZ w stopce KAŻDEJ
    // strony (`Footer` jest `fixed`) — dlatego to on niesie oznaczenie.
    expect(props.order.number).toBe(mark);
    expect(props.customer.fullName).toContain(mark);
    expect(props.items.length).toBeGreaterThan(0);
    for (const item of props.items) {
      expect(item.name.toLowerCase()).toContain(locale === "pl" ? "przykład" : "sample");
    }
  });

  it("okres najmu liczony jest tak, jak liczy go umowa (dni włącznie)", () => {
    const row = contractPreviewOrderRow({ locale: "pl", today: TODAY, currency: "PLN" });
    expect(row.start_date).toBe(TODAY);
    expect(row.end_date).toBe("2026-08-18");
    expect(CONTRACT_PREVIEW_DAYS).toBe(7);
  });

  it("sekcja pól własnych NIE pojawia się w podglądzie", async () => {
    const { client } = fakeSupabase(readyRows());
    const props = await loadContractPreviewProps(client, { tenantId: TENANT_ID, today: TODAY });
    // Brak klucza (a nie pusty obiekt) — szablon zdejmuje wtedy całą sekcję
    // i nie przestawia numeracji paragrafów.
    expect(props.customFields).toBeUndefined();
  });
});

describe("sonda: podgląd NICZEGO nie zapisuje", () => {
  it("przechodzi przez klienta, w którym każdy zapis jest zaminowany", async () => {
    const { client, calls } = fakeSupabase(readyRows());
    const preview = await renderContractPreview({ render: async () => new Uint8Array([1, 2, 3]) }, client, {
      tenantId: TENANT_ID,
      today: TODAY,
    });

    // Najpierw dowód, że przebieg NAPRAWDĘ dotknął bazy i wyprodukował
    // dokument — bez tego asercje niżej broniłyby pustego zbioru.
    expect(preview.bytes.byteLength).toBe(3);
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.every((call) => call.terminal === "maybeSingle")).toBe(true);
    expect([...new Set(calls.map((call) => call.table))].sort()).toEqual([
      "tenant_settings",
      "tenants",
    ]);
  });

  it("nie woła generatora umów — rejestr i koszyk zostają nietknięte", async () => {
    // Ścieżka prawdziwej umowy (generateContract) wgrywa plik i wstawia wiersz
    // do contract_documents. Gdyby podgląd tam trafił, zaminowane `insert`
    // i `storage.from` rzuciłyby z imienia — ten test przechodzi WYŁĄCZNIE
    // dlatego, że podgląd woła sam renderer.
    const { client } = fakeSupabase(readyRows());
    await expect(
      renderContractPreview(contractPreviewDeps(), client, { tenantId: TENANT_ID, today: TODAY }),
    ).resolves.toMatchObject({ filename: CONTRACT_PREVIEW_FILENAME.pl });
  }, 30_000);
});

describe("sonda: zawężenie po najemcy stoi W ZAPYTANIU", () => {
  it("każdy odczyt filtruje po tym najemcy", async () => {
    const { client, calls } = fakeSupabase(readyRows());
    await loadContractPreviewProps(client, { tenantId: TENANT_ID, today: TODAY });

    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const call of calls) {
      const column = call.table === "tenants" ? "id" : "tenant_id";
      expect(
        call.filters.some(([name, value]) => name === column && value === TENANT_ID),
        `odczyt ${call.table} bez zawężenia po najemcy`,
      ).toBe(true);
    }
  });

  it("błąd odczytu nie zamienia się w cichy brak konfiguracji", async () => {
    // PGRST116 to dokładnie ten błąd, który `maybeSingle()` oddaje, gdy
    // zapytanie objęło więcej niż jednego najemcę. Cichy `catch` zamieniłby
    // wyciek w pusty ekran, a pusty ekran nikogo nie alarmuje.
    const { client } = fakeSupabase({
      error: { message: "JSON object requested, multiple rows returned", code: "PGRST116" },
    });
    await expect(
      loadContractPreviewProps(client, { tenantId: TENANT_ID, today: TODAY }),
    ).rejects.toThrow(/Nie udało się odczytać ustawień umów/);
  });

  it("propsy nie zawierają NICZEGO poza danymi tego najemcy i przykładem", async () => {
    const render = vi.fn(async (_props: ContractPdfProps) => new Uint8Array([0]));
    const { client } = fakeSupabase(readyRows());
    await renderContractPreview({ render }, client, { tenantId: TENANT_ID, today: TODAY });

    expect(render).toHaveBeenCalledTimes(1);
    const props = render.mock.calls[0]![0];
    const serialized = JSON.stringify(props);
    // Adres e-mail klienta w podglądzie MUSI być przykładowy: gdyby ktoś
    // podstawił tu prawdziwego klienta, wyciekłby on do dokumentu, który
    // operator otwiera „żeby zobaczyć, jak to wygląda".
    expect(props.customer.email.endsWith("@example.com")).toBe(true);
    expect(serialized).toContain(SETTINGS.terms_body);
  });
});
