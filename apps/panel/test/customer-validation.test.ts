import { describe, expect, it } from "vitest";

import {
  customerEditSchema,
  customerEditFromFormData,
  customersFilterSchema,
} from "@/lib/customer-validation";
import {
  customerMatchesSearch,
  filterCustomersBySearch,
} from "@/lib/customers/customer-search";
import { resolveCustomerSort, sortCustomers } from "@/lib/customers/customer-sort";

/**
 * Walidacja i logika listy klientów (R6a).
 *
 * customerEditSchema lustrzy checkout: luźny adres/NIP, e-mail wymagany,
 * puste opcjonalne pola stają się `null`. Wyszukiwarka i sort działają nad
 * stroną w pamięci — tu dowodzimy, że NAPRAWDĘ zawężają i porządkują.
 */

function formData(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

const VALID = {
  email: "  Anna@Example.com ",
  fullName: "  Anna Kowalska  ",
  phone: " +48 600 100 200 ",
  companyName: "  Studio Plan B  ",
  nip: " 5250000000 ",
  addressStreet: " Polna 4 ",
  addressZip: " 00-001 ",
  addressCity: " Warszawa ",
};

describe("customerEditSchema", () => {
  it("przyjmuje komplet, przycina pola i zachowuje wartości", () => {
    const parsed = customerEditSchema.parse(customerEditFromFormData(formData(VALID)));
    expect(parsed).toEqual({
      email: "Anna@Example.com",
      fullName: "Anna Kowalska",
      phone: "+48 600 100 200",
      companyName: "Studio Plan B",
      nip: "5250000000",
      addressStreet: "Polna 4",
      addressZip: "00-001",
      addressCity: "Warszawa",
    });
  });

  it("puste pola opcjonalne stają się null (nie pustym stringiem)", () => {
    const parsed = customerEditSchema.parse(
      customerEditFromFormData(formData({ email: "jan@example.com" })),
    );
    expect(parsed).toMatchObject({
      email: "jan@example.com",
      fullName: null,
      phone: null,
      companyName: null,
      nip: null,
      addressStreet: null,
      addressZip: null,
      addressCity: null,
    });
  });

  it("odrzuca niepoprawny e-mail komunikatem przy polu email", () => {
    const result = customerEditSchema.safeParse(
      customerEditFromFormData(formData({ email: "to-nie-jest-mail" })),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]!.path[0]).toBe("email");
  });

  it("odrzuca za krótki e-mail (lustro CHECK length between 3 and 320)", () => {
    const result = customerEditSchema.safeParse(
      customerEditFromFormData(formData({ email: "a" })),
    );
    expect(result.success).toBe(false);
  });

  it("telefon krótszy niż 4 znaki jest błędem, pusty jest dozwolony", () => {
    const short = customerEditSchema.safeParse(
      customerEditFromFormData(formData({ email: "jan@example.com", phone: "12" })),
    );
    expect(short.success).toBe(false);
    if (!short.success) expect(short.error.issues[0]!.path[0]).toBe("phone");

    const empty = customerEditSchema.safeParse(
      customerEditFromFormData(formData({ email: "jan@example.com", phone: "   " })),
    );
    expect(empty.success).toBe(true);
    if (empty.success) expect(empty.data.phone).toBeNull();
  });

  it("NIP dłuższy niż 32 znaki jest błędem przy polu nip", () => {
    const result = customerEditSchema.safeParse(
      customerEditFromFormData(formData({ email: "jan@example.com", nip: "1".repeat(33) })),
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]!.path[0]).toBe("nip");
  });

  it("kod pocztowy dłuższy niż 20 znaków jest błędem przy polu addressZip", () => {
    const result = customerEditSchema.safeParse(
      customerEditFromFormData(formData({ email: "jan@example.com", addressZip: "0".repeat(21) })),
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]!.path[0]).toBe("addressZip");
  });
});

describe("customersFilterSchema", () => {
  it("przyjmuje poprawne q/sort/dir", () => {
    expect(customersFilterSchema.parse({ q: "anna", sort: "zamowienia", dir: "desc" })).toEqual({
      q: "anna",
      sort: "zamowienia",
      dir: "desc",
    });
  });

  it("ignoruje nieznany sort/dir zamiast wywracać ekran", () => {
    const parsed = customersFilterSchema.parse({ sort: "wymyslony", dir: "boczny" });
    expect(parsed.sort).toBeUndefined();
    expect(parsed.dir).toBeUndefined();
  });

  it("puste q staje się undefined (brak filtra)", () => {
    expect(customersFilterSchema.parse({ q: "   " }).q).toBeUndefined();
  });
});

describe("customer-search", () => {
  const rows = [
    { id: "1", fullName: "Anna Kowalska", email: "anna@example.com", phone: "+48 600 100 200" },
    { id: "2", fullName: "Michał Nowak", email: "michal@firma.pl", phone: null },
    { id: "3", fullName: null, email: "biuro@studioplanb.pl", phone: "223334455" },
  ];

  it("puste zapytanie pasuje do wszystkich", () => {
    expect(filterCustomersBySearch(rows, "")).toHaveLength(3);
  });

  it("zawęża po nazwisku (case-insensitive, częściowo)", () => {
    const found = filterCustomersBySearch(rows, "kowal");
    expect(found.map((r) => r.id)).toEqual(["1"]);
  });

  it("zawęża po fragmencie e-maila", () => {
    expect(filterCustomersBySearch(rows, "firma.pl").map((r) => r.id)).toEqual(["2"]);
  });

  it("zawęża po numerze telefonu", () => {
    expect(filterCustomersBySearch(rows, "2233").map((r) => r.id)).toEqual(["3"]);
  });

  it("fraza bez dopasowania daje pustą listę", () => {
    expect(filterCustomersBySearch(rows, "xyz-nie-ma")).toEqual([]);
  });

  it("dopasowanie pojedynczego wiersza jest spójne z filtrem", () => {
    expect(customerMatchesSearch(rows[0]!, "ANNA@")).toBe(true);
    expect(customerMatchesSearch(rows[1]!, "kowalska")).toBe(false);
  });
});

describe("customer-sort", () => {
  const rows = [
    { customerLabel: "Cezary", orderCount: 1, lastOrderAt: "2026-05-01T00:00:00Z" },
    { customerLabel: "Anna", orderCount: 5, lastOrderAt: "2026-07-01T00:00:00Z" },
    { customerLabel: "Bartek", orderCount: 0, lastOrderAt: null },
  ];

  it("domyślnie sortuje alfabetycznie po kliencie", () => {
    const sort = resolveCustomerSort(undefined, undefined);
    expect(sortCustomers(rows, sort, "pl").map((r) => r.customerLabel)).toEqual([
      "Anna",
      "Bartek",
      "Cezary",
    ]);
  });

  it("po liczbie zamówień malejąco stawia najczęstszego klienta na górze", () => {
    const sort = resolveCustomerSort("zamowienia", "desc");
    expect(sortCustomers(rows, sort, "pl").map((r) => r.orderCount)).toEqual([5, 1, 0]);
  });

  it("po ostatnim zamówieniu: brak daty ZAWSZE na końcu, niezależnie od kierunku", () => {
    for (const dir of ["asc", "desc"] as const) {
      const sorted = sortCustomers(rows, resolveCustomerSort("ostatnie", dir), "pl");
      expect(sorted.at(-1)!.customerLabel, `kierunek ${dir}`).toBe("Bartek");
    }
  });
});
