/**
 * KONTRAKT: każda ścieżka wysyłki panelu zapisuje w historii TĘ SAMĄ treść,
 * którą podała transportowi (uwaga właściciela D10, 0035/ADR-073).
 *
 * ================== PO CO OSOBNY, WSPÓLNY TEST ==================
 *
 * Każda ze ścieżek ma własną suitę i własne asercje o metadanych (rodzaj,
 * status, powód). Żadna z nich nie odpowiada jednak na pytanie, które zadaje
 * to zadanie: „czy to, co widzi operator w podglądzie, jest tym, co dostał
 * klient". To pytanie jest z natury POROWNANIEM DWÓCH STRON — argumentu
 * transportu i wpisu rejestru — i musi być zadane KAŻDEJ ścieżce osobno,
 * bo regresja jest z natury lokalna: jedna ścieżka przestaje iść przez
 * `sendAndLog` (np. „bo tu potrzebuję własnej obsługi błędu"), zaczyna wołać
 * transport i rejestrator sama, i cicho gubi treść. Metadane wyglądają wtedy
 * normalnie, a podgląd mówi „treść niedostępna" dla ŚWIEŻEJ wiadomości.
 *
 * Dowód mutacyjny (opisany w dzienniku): przepisanie JEDNEJ ścieżki na
 * `transport.send` + `recorder.record` z pominięciem `sendAndLog` zapala
 * dokładnie jej przypadek, a nie cztery pozostałe.
 *
 * ================== ASERCJA JEST TOŻSAMOŚCIĄ, NIE PODOBIEŃSTWEM ==================
 *
 * `toBe` na `entry.body` i `sent.html` porównuje REFERENCJĘ tego samego
 * napisu — czyli sprawdza, że treść nie została policzona drugi raz „do
 * rejestru". Druga kopia szablonu potrafi różnić się od tej, którą zobaczył
 * klient (inne dane tenanta, inny cennik, inny render), i różnić się bez
 * ostrzeżenia — a rejestr, który wygląda na dowód, nie będąc nim, jest
 * gorszy niż jego brak.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type {
  EmailLogEntry,
  EmailLogRecorder,
  EmailTransport,
  OutgoingEmail,
  TenantSettingRow,
} from "@avably/core";

import { sendInvitationEmail } from "@/lib/email";
import { sendRentalEmailForTransition } from "@/app/[locale]/(panel)/zamowienia/[id]/rental-email";
import {
  sendPickupReturnReminderEmail,
  sendReturnLabelEmail,
} from "@/app/[locale]/(panel)/zamowienia/[id]/return-email";
import {
  sendContract,
  type ContractDocumentRow,
  type ContractServiceDeps,
} from "@/app/[locale]/(panel)/zamowienia/[id]/contract-service";
import { sha256Hex } from "@/app/[locale]/(panel)/zamowienia/[id]/contract-document";
import { sendInvoice } from "@/app/[locale]/(panel)/zamowienia/[id]/invoice-service";

const APP_ROOT = resolve(__dirname, "..");

function captureTransport(fail?: Error): {
  transport: EmailTransport;
  sent: OutgoingEmail[];
} {
  const sent: OutgoingEmail[] = [];
  return {
    transport: {
      send: async (email) => {
        // Zapis PRZED ewentualnym błędem: nieudana próba też ma w rejestrze
        // zostawić treść, którą wypuszczaliśmy (operator w sporze pyta „co
        // miało pójść", nie tylko „co poszło").
        sent.push(email);
        if (fail) throw fail;
        return { id: "resend-1" };
      },
    },
    sent,
  };
}

function captureRecorder(): { recorder: EmailLogRecorder; entries: EmailLogEntry[] } {
  const entries: EmailLogEntry[] = [];
  return { recorder: { record: async (entry) => void entries.push(entry) }, entries };
}

const settings: TenantSettingRow[] = [
  {
    key: "email_sender",
    value: { name: "Wypożyczalnia Demo", reply_to: "kontakt@example.com" },
  } as unknown as TenantSettingRow,
];

const availability = { available: true } as const;
const customer = { full_name: "Jan Kowalski", email: "klient@example.com", locale: null };

/** Ścieżka wysyłki = jedno wywołanie realnej funkcji panelu, bez atrap w środku. */
interface Path {
  name: string;
  kind: string;
  run(deps: {
    transport: EmailTransport;
    recorder: EmailLogRecorder;
  }): Promise<unknown>;
}

const contractBytes = new Uint8Array([37, 80, 68, 70, 45, 49]);
const contractRow: ContractDocumentRow = {
  id: "doc-1",
  tenant_id: "tenant-1",
  order_id: "order-1",
  storage_path: "tenant-1/order-1/doc-1.pdf",
  sha256: sha256Hex(contractBytes),
  locale: "pl",
  terms_version: "v1",
  recipient: "anna@example.pl",
  created_by: "user-1",
  created_at: "2026-07-22T00:00:00Z",
};

function contractDeps(transport: EmailTransport, recorder: EmailLogRecorder): ContractServiceDeps {
  return {
    createId: () => "doc-1",
    render: vi.fn(async () => contractBytes),
    repository: {
      findByHash: vi.fn(async () => null),
      insert: vi.fn(async (value) => ({ ...value, created_at: contractRow.created_at })),
      findById: vi.fn(async () => contractRow),
      findAttempt: vi.fn(async () => null),
    },
    storage: {
      upload: vi.fn(async () => undefined),
      download: vi.fn(async () => contractBytes),
      removeOrphan: vi.fn(async () => undefined),
    },
    transport,
    recorder,
  };
}

/**
 * Wszystkie ścieżki, którymi panel wysyła pocztę. Lista jest wyczerpująca —
 * pilnuje tego test-strażnik niżej (skan wołających `panelEmailLogRecorder`).
 */
const PATHS: readonly Path[] = [
  {
    name: "cykl najmu (zamowienia/actions.ts → rental-email.ts)",
    kind: "rental_picked_up",
    run: ({ transport, recorder }) =>
      sendRentalEmailForTransition({
        status: "picked_up",
        order: {
          order_number: "AV-2026-001",
          start_date: "2026-08-01",
          end_date: "2026-08-05",
          currency: "PLN",
          total_rental_grosze: 55_000,
          customers: { full_name: "Jan Kowalski", email: "klient@example.com" },
          pickup_locations: null,
        },
        orderId: "11111111-1111-4111-8111-111111111111",
        tenantName: "Wypożyczalnia Demo",
        locale: "pl",
        currency: "PLN",
        settings,
        availability,
        transport,
        recorder,
      }),
  },
  {
    name: "etykieta zwrotna (delivery-actions.ts → return-email.ts)",
    kind: "return_label",
    run: ({ transport, recorder }) =>
      sendReturnLabelEmail({
        availability,
        customer,
        settings,
        tenantName: "Wypożyczalnia Demo",
        tenantLocale: "pl",
        orderNumber: "AV-2026-001",
        endDate: "2026-08-05",
        shipmentNumber: "GK240610123456",
        labelPdf: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        orderId: "11111111-1111-4111-8111-111111111111",
        transport,
        recorder,
      }),
  },
  {
    name: "przypomnienie o zwrocie (delivery-actions.ts → return-email.ts)",
    kind: "pickup_return_reminder",
    run: ({ transport, recorder }) =>
      sendPickupReturnReminderEmail({
        availability,
        customer,
        settings,
        tenantName: "Wypożyczalnia Demo",
        tenantLocale: "pl",
        orderNumber: "AV-2026-001",
        endDate: "2026-08-05",
        locationName: "Punkt Centrum",
        locationAddress: "Testowa 1, Warszawa",
        orderId: "11111111-1111-4111-8111-111111111111",
        transport,
        recorder,
      }),
  },
  {
    name: "zaproszenie do organizacji (zaproszenia/actions.ts → lib/email.ts)",
    kind: "invitation",
    run: ({ transport, recorder }) =>
      sendInvitationEmail({
        to: "nowy@example.com",
        acceptUrl: "https://www.avably.io/zaproszenie/abc123",
        locale: "pl",
        organizationName: "Wypożyczalnia Demo",
        role: "staff",
        settings,
        availability,
        transport,
        recorder,
      }),
  },
  {
    name: "umowa najmu (contract-actions.ts → contract-service.ts)",
    kind: "rental_contract",
    run: ({ transport, recorder }) =>
      sendContract(contractDeps(transport, recorder), {
        tenantId: "tenant-1",
        orderId: "order-1",
        documentId: "doc-1",
        attemptId: "attempt-1",
        tenantName: "Najem Demo",
        customerName: "Anna",
        orderNumber: "ZAM-1",
        fromEmail: "send@avably.pl",
      }),
  },
  {
    name: "faktura (invoice-actions.ts → invoice-service.ts)",
    kind: "invoice",
    run: ({ transport, recorder }) =>
      sendInvoice(
        { transport, recorder },
        {
          orderId: "11111111-1111-4111-8111-111111111111",
          locale: "pl",
          tenantName: "Wypożyczalnia Demo",
          customerName: "Jan Kowalski",
          customerEmail: "klient@example.com",
          orderNumber: "AV-2026-001",
          bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
          filename: "FV-2026-07-0042.pdf",
          fromEmail: "send@avably.pl",
        },
      ),
  },
];

describe("historia komunikacji — treść w rejestrze = treść u klienta (ADR-073)", () => {
  it.each(PATHS)("$name: udana wysyłka zapisuje DOKŁADNIE wysłany HTML", async (path) => {
    const { transport, sent } = captureTransport();
    const { recorder, entries } = captureRecorder();

    await path.run({ transport, recorder });

    expect(sent).toHaveLength(1);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe(path.kind);
    expect(entries[0]!.status).toBe("sent");
    // Treść jest, jest niepusta i jest TYM SAMYM napisem, który dostał transport.
    expect(entries[0]!.body).toBeTypeOf("string");
    expect((entries[0]!.body as string).length).toBeGreaterThan(0);
    expect(entries[0]!.body).toBe(sent[0]!.html);
  });

  it.each(PATHS)("$name: NIEUDANA wysyłka też zachowuje treść", async (path) => {
    const { transport, sent } = captureTransport(new Error("HTTP 422 domain not verified"));
    const { recorder, entries } = captureRecorder();

    await path.run({ transport, recorder });

    expect(sent).toHaveLength(1);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.status).toBe("failed");
    expect(entries[0]!.error).toContain("422");
    // Porażka bez treści zostawiałaby operatora z pytaniem „co miało pójść"
    // dokładnie tam, gdzie jest ono najczęstsze.
    expect(entries[0]!.body).toBe(sent[0]!.html);
  });

  /**
   * TEST-PRZYNĘTA WYCZERPUJĄCOŚCI. Powyższe `it.each` broni tylko tych
   * ścieżek, które ktoś na tę listę wpisał. Nowa ścieżka wysyłki dołożona
   * bez wpisu byłaby więc niebroniona, a suita — zielona. Skan wiąże listę
   * z rzeczywistością: rejestrator panelu wołają DOKŁADNIE cztery pliki
   * akcji, a każdy z nich prowadzi do ścieżki z listy wyżej.
   */
  it("lista ścieżek pokrywa wszystkich wołających rejestratora panelu", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".next") continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) files.push(full);
      }
    };
    walk(join(APP_ROOT, "app"));

    const callers = files
      .filter((file) => /panelEmailLogRecorder\(/.test(readFileSync(file, "utf8")))
      .map((file) => relative(APP_ROOT, file))
      .sort();

    expect(callers).toEqual([
      "app/[locale]/(panel)/zamowienia/[id]/contract-actions.ts",
      "app/[locale]/(panel)/zamowienia/[id]/delivery-actions.ts",
      "app/[locale]/(panel)/zamowienia/[id]/invoice-actions.ts",
      "app/[locale]/(panel)/zamowienia/actions.ts",
      "app/[locale]/(panel)/zaproszenia/actions.ts",
    ]);
    // delivery-actions.ts prowadzi do DWÓCH ścieżek (etykieta i przypomnienie).
    expect(PATHS).toHaveLength(callers.length + 1);
  });
});

/**
 * KONTRAKT (łatka recenzji PM): podgląd treści renderuje zapisany HTML
 * WYŁĄCZNIE w izolowanej ramce.
 *
 * Zapisany `body` niesie dane pochodzące od klienta (nazwa, adres, uwagi
 * z zamówienia), a po N3 zacznie nieść treść redagowaną w panelu. Wstrzyknięcie
 * go w drzewo panelu przez `dangerouslySetInnerHTML` zamienia historię
 * komunikacji w wektor TRWAŁEGO XSS-a wymierzonego w operatora — z zapisu,
 * który wygląda na zwykły dowód wysyłki.
 *
 * Bezpieczeństwo ma tu być WŁASNOŚCIĄ KONSTRUKCJI (pusty `sandbox` odbiera
 * dokumentowi skrypty, formularze, nawigację i dostęp do rodzica), a nie
 * skutkiem ubocznym escapowania w szablonach — bo escapowanie przestanie
 * wystarczać w dniu, w którym treść zacznie pochodzić od operatora.
 *
 * Skan ŹRÓDŁA, nie renderu: `srcDoc`/`sandbox` to atrybuty, których jsdom nie
 * egzekwuje, więc test renderujący przeszedłby także BEZ nich — czyli byłby
 * bramką, która nie umie spłonąć.
 */
describe("kontrakt podglądu treści — izolacja renderowanego HTML-a", () => {
  const PREVIEW = join(
    APP_ROOT,
    "app/[locale]/(panel)/zamowienia/[id]/email-preview-modal.tsx",
  );

  it("zapisany HTML idzie do <iframe srcDoc> z PUSTYM sandboxem", () => {
    const source = readFileSync(PREVIEW, "utf8");
    expect(source, "podgląd przestał używać ramki").toMatch(/<iframe/);
    expect(source, "ramka bez srcDoc").toMatch(/srcDoc=/);
    expect(source, "ramka bez pustego sandboxa — dokument odzyskuje skrypty").toMatch(
      /sandbox=""/,
    );
  });

  it("żaden plik sekcji historii nie wstrzykuje HTML-a w drzewo panelu", () => {
    for (const file of [
      "email-preview-modal.tsx",
      "email-log-section.tsx",
      "email-body-actions.ts",
    ]) {
      const source = readFileSync(
        join(APP_ROOT, "app/[locale]/(panel)/zamowienia/[id]", file),
        "utf8",
      );
      // Szukamy UŻYCIA (`dangerouslySetInnerHTML={...}`), nie wzmianki:
      // nagłówek modalu OPISUJE, dlaczego tej drogi nie wybrano, a bramka
      // zakazująca nazwania decyzji karałaby za dokumentowanie jej.
      expect(source, `${file} wstrzykuje HTML w drzewo panelu`).not.toMatch(
        /dangerouslySetInnerHTML\s*=/,
      );
    }
  });
});
