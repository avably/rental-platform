/**
 * Warstwa HTTP eksportów CSV (C2, ADR-111) — route handlery na atrapach
 * (guard podmieniony, zero Supabase). Bronione WYNIKI:
 *
 *  1. ANON: 401 PRZED jakąkolwiek pracą — handler nie tyka ciała żądania
 *     ani bazy, gdy guard rzuca (odmowa przed pracą, sonda §5 pkt 3).
 *  2. Eksport klientów żąda roli OWNER już na guardzie (requireMember
 *     dostaje argument "owner"); zamówienia i katalog — bez argumentu.
 *  3. Zły zakres dat → redirect 303 na ekran z kodem `zakres`, bez odczytu.
 *  4. ExportLimitError z rdzenia → redirect 303 z kodem `limit` — jawny
 *     komunikat, nie cichy obcinek.
 *  5. Szczęśliwa ścieżka: text/csv + charset, attachment z nazwą
 *     `avably-<typ>-<data>.csv`, cache-control private/no-store, treść od BOM.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthError } from "@/lib/auth";
import { ExportLimitError } from "@/lib/export/common";

const requireMemberMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase-server", () => ({ requireMember: requireMemberMock }));

const exportOrdersMock = vi.hoisted(() => vi.fn());
const exportCustomersMock = vi.hoisted(() => vi.fn());
const exportCatalogMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/export/orders", () => ({ exportOrdersCsv: exportOrdersMock }));
vi.mock("@/lib/export/customers", () => ({ exportCustomersCsv: exportCustomersMock }));
vi.mock("@/lib/export/catalog", () => ({ exportCatalogCsv: exportCatalogMock }));

const { POST: postOrders } = await import(
  "@/app/[locale]/(panel)/eksport-danych/zamowienia/route"
);
const { POST: postCustomers } = await import(
  "@/app/[locale]/(panel)/eksport-danych/klienci/route"
);
const { POST: postCatalog } = await import("@/app/[locale]/(panel)/eksport-danych/katalog/route");

const params = (locale = "pl") => ({ params: Promise.resolve({ locale }) });

const memberCtx = (role: "owner" | "staff" = "owner") => ({
  user: { id: "u1", email: "op@test.local" },
  tenantId: "t1",
  role,
  superadmin: false,
  aal: "aal1",
  tenantStatus: "active",
  supabase: new Proxy(
    {},
    {
      get() {
        throw new Error("handler nie ma prawa dotknąć Supabase w tym teście");
      },
    },
  ),
});

/** Żądanie z licznikiem odczytów ciała — dowód „odmowa PRZED pracą". */
function trackedRequest(body: Record<string, string> = {}): {
  request: Request;
  bodyReads: () => number;
} {
  let reads = 0;
  const form = new URLSearchParams(body);
  const request = new Request("https://panel.test/pl/eksport-danych/zamowienia", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const original = request.formData.bind(request);
  Object.defineProperty(request, "formData", {
    value: () => {
      reads += 1;
      return original();
    },
  });
  return { request, bodyReads: () => reads };
}

beforeEach(() => {
  vi.clearAllMocks();
  exportOrdersMock.mockResolvedValue({
    filename: "avably-orders-2026-08-08.csv",
    csv: "﻿a;b\r\n",
  });
  exportCustomersMock.mockResolvedValue({
    filename: "avably-customers-2026-08-08.csv",
    csv: "﻿a;b\r\n",
  });
  exportCatalogMock.mockResolvedValue({
    filename: "avably-catalog-2026-08-08.csv",
    csv: "﻿a;b\r\n",
  });
});

describe("anonim — 401 przed jakąkolwiek pracą", () => {
  it.each([
    ["zamówienia", postOrders],
    ["klienci", postCustomers],
    ["katalog", postCatalog],
  ] as const)("POST %s → 401, ciało nietknięte, rdzeń niewywołany", async (_label, handler) => {
    requireMemberMock.mockRejectedValue(new AuthError(401, "Zaloguj się."));
    const { request, bodyReads } = trackedRequest({ date_from: "2026-01-01" });

    const response = await handler(request, params());

    expect(response.status).toBe(401);
    expect(bodyReads()).toBe(0);
    expect(exportOrdersMock).not.toHaveBeenCalled();
    expect(exportCustomersMock).not.toHaveBeenCalled();
    expect(exportCatalogMock).not.toHaveBeenCalled();
  });
});

describe("bramka roli na guardzie", () => {
  it("klienci żądają roli owner (argument requireMember), staff dostaje 403", async () => {
    requireMemberMock.mockRejectedValue(new AuthError(403, "Tylko właściciel."));
    const { request } = trackedRequest();

    const response = await postCustomers(request, params());

    expect(response.status).toBe(403);
    // Drugi argument to opt-in okna domykania (ADR-138): eksport RODO musi
    // działać u zawieszonego najemcy w oknie — rola pozostaje bez zmian.
    expect(requireMemberMock).toHaveBeenCalledWith("owner", { closing: true });
    expect(exportCustomersMock).not.toHaveBeenCalled();
  });

  it("zamówienia i katalog nie zawężają roli (spójnie z ekranami list, ADR-109)", async () => {
    requireMemberMock.mockResolvedValue(memberCtx("staff"));
    await postOrders(trackedRequest().request, params());
    await postCatalog(trackedRequest().request, params());
    expect(requireMemberMock).toHaveBeenNthCalledWith(1, undefined, { closing: true });
    expect(requireMemberMock).toHaveBeenNthCalledWith(2, undefined, { closing: true });
  });
});

describe("błędy miękkie — redirect 303 z kodem, nie cichy obcinek", () => {
  beforeEach(() => {
    requireMemberMock.mockResolvedValue(memberCtx());
  });

  it.each([
    [{ date_from: "2026-13-99" }],
    [{ date_to: "nie-data" }],
    [{ date_from: "2026-09-20", date_to: "2026-09-01" }],
  ])("zły zakres dat %j → 303 ?blad=zakres, rdzeń niewywołany", async (body) => {
    const { request } = trackedRequest(body);
    const response = await postOrders(request, params());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/pl/eksport-danych?blad=zakres");
    expect(exportOrdersMock).not.toHaveBeenCalled();
  });

  it("przekroczony limit wierszy → 303 ?blad=limit (locale z trasy)", async () => {
    exportCatalogMock.mockRejectedValue(new ExportLimitError());
    const response = await postCatalog(trackedRequest().request, params("en"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/en/eksport-danych?blad=limit");
  });

  it("śmieciowy segment locale spada na pl — redirect nie jest otwartym przekierowaniem", async () => {
    exportOrdersMock.mockRejectedValue(new ExportLimitError());
    const response = await postOrders(trackedRequest().request, params("https://zly.example"));
    expect(response.headers.get("location")).toBe("/pl/eksport-danych?blad=limit");
  });
});

describe("szczęśliwa ścieżka", () => {
  beforeEach(() => {
    requireMemberMock.mockResolvedValue(memberCtx());
  });

  it("zamówienia: zakres z ciała formularza idzie do rdzenia, odpowiedź to plik CSV", async () => {
    const { request } = trackedRequest({ date_from: "2026-09-01", date_to: "2026-09-30" });
    const response = await postOrders(request, params());

    expect(exportOrdersMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "t1", role: "owner" }),
      { from: "2026-09-01", to: "2026-09-30" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="avably-orders-2026-08-08.csv"',
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    // `Response.text()` zdejmuje BOM przy dekodowaniu (spec) — mierzymy BAJTY:
    // strumień MUSI zaczynać się od EF BB BF, inaczej Excel zgadnie cp1250.
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3))).toBe("a;b\r\n");
  });

  it("puste pola dat są legalne — eksport całości bez filtra", async () => {
    const { request } = trackedRequest({ date_from: "", date_to: "" });
    await postOrders(request, params());
    expect(exportOrdersMock).toHaveBeenCalledWith(expect.anything(), {});
  });

  it("klienci i katalog nie czytają ciała żądania w ogóle", async () => {
    const customers = trackedRequest();
    await postCustomers(customers.request, params());
    const catalog = trackedRequest();
    await postCatalog(catalog.request, params());
    expect(customers.bodyReads()).toBe(0);
    expect(catalog.bodyReads()).toBe(0);
    expect(exportCustomersMock).toHaveBeenCalled();
    expect(exportCatalogMock).toHaveBeenCalled();
  });
});
