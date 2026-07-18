/**
 * Bramka CI: KAŻDA chroniona trasa panelu odsyła anonima na logowanie — i to
 * na logowanie w JEGO języku.
 *
 * Guard nie siedzi w layoucie (patrz app/[locale]/(superadmin)/layout.tsx):
 * każda strona woła go u siebie. To znaczy, że nowa strona bez guarda jest
 * cicho publiczna — nic jej nie łapie: ani typy, ani build. Ten plik jest
 * jedynym miejscem, które to wyłapie, dlatego lista niżej ma rosnąć razem
 * z panelem.
 *
 * Testowane bez Supabase (klient zamockowany na „brak sesji"), więc bramka
 * działa w jobie `ci`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthError } from "@/lib/auth";

let currentLocale = "pl";

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`REDIRECT:${url}`);
  }
}
class NotFoundSignal extends Error {}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
  permanentRedirect: (url: string) => {
    throw new RedirectSignal(url);
  },
  notFound: () => {
    throw new NotFoundSignal("NOT_FOUND");
  },
}));

vi.mock("next-intl/server", () => ({
  getLocale: async () => currentLocale,
  // Strony wołają tłumaczenia dopiero PO guardzie — gdyby któraś zawołała je
  // wcześniej, ta atrapa i tak nie przepuści testu na zielono przez przypadek.
  getTranslations: async () => (key: string) => key,
}));

/** Sesji nie ma: getClaims zwraca pustkę, guardy rzucają 401. */
vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: async () => ({ data: null, error: null }),
      mfa: { listFactors: async () => ({ data: { totp: [] } }) },
    },
  }),
  requireMember: async () => {
    throw new AuthError(401, "Wymagane zalogowanie.");
  },
  requireSuperadmin: async () => {
    throw new AuthError(401, "Wymagane zalogowanie.");
  },
}));

const TENANT_ID = "00000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "00000000-0000-4000-8000-000000000002";
const LOCATION_ID = "00000000-0000-4000-8000-000000000003";
const ORDER_ID = "00000000-0000-4000-8000-000000000004";

/**
 * Chronione trasy panelu. `run` woła moduł strony dokładnie tak, jak zrobiłby
 * to Next.js dla anonimowego żądania.
 */
const PROTECTED_ROUTES: { name: string; run: () => Promise<unknown> }[] = [
  {
    name: "/bezpieczenstwo",
    run: async () => (await import("@/app/[locale]/bezpieczenstwo/page")).default(),
  },
  {
    name: "/bezpieczenstwo/wyzwanie",
    run: async () =>
      (await import("@/app/[locale]/bezpieczenstwo/wyzwanie/page")).default({
        searchParams: Promise.resolve({}),
      }),
  },
  {
    name: "/organizacja/nowa",
    run: async () => (await import("@/app/[locale]/organizacja/nowa/page")).default(),
  },
  {
    name: "/zaproszenia",
    run: async () => (await import("@/app/[locale]/zaproszenia/page")).default(),
  },
  {
    name: "/zaproszenie/[token]",
    run: async () =>
      (await import("@/app/[locale]/zaproszenie/[token]/page")).default({
        params: Promise.resolve({ token: "token-testowy" }),
      }),
  },
  // Katalog (Zadanie 3): guard requireMemberPage w każdej stronie — bramka
  // z PR #21 łapie nową trasę wyłącznie przez wpis na tej liście.
  {
    name: "/katalog",
    run: async () => (await import("@/app/[locale]/katalog/page")).default(),
  },
  {
    name: "/katalog/nowy",
    run: async () => (await import("@/app/[locale]/katalog/nowy/page")).default(),
  },
  {
    name: "/katalog/[id]",
    run: async () =>
      (await import("@/app/[locale]/katalog/[id]/page")).default({
        params: Promise.resolve({ id: PRODUCT_ID }),
      }),
  },
  {
    name: "/katalog/[id]/egzemplarze",
    run: async () =>
      (await import("@/app/[locale]/katalog/[id]/egzemplarze/page")).default({
        params: Promise.resolve({ id: PRODUCT_ID }),
      }),
  },
  {
    name: "/katalog/[id]/progi",
    run: async () =>
      (await import("@/app/[locale]/katalog/[id]/progi/page")).default({
        params: Promise.resolve({ id: PRODUCT_ID }),
      }),
  },
  {
    name: "/katalog/punkty-odbioru",
    run: async () => (await import("@/app/[locale]/katalog/punkty-odbioru/page")).default(),
  },
  {
    name: "/katalog/punkty-odbioru/nowy",
    run: async () => (await import("@/app/[locale]/katalog/punkty-odbioru/nowy/page")).default(),
  },
  {
    name: "/katalog/punkty-odbioru/[locationId]",
    run: async () =>
      (await import("@/app/[locale]/katalog/punkty-odbioru/[locationId]/page")).default({
        params: Promise.resolve({ locationId: LOCATION_ID }),
      }),
  },
  // Zamówienia (Zadanie 4): guard requireMemberPage w każdej stronie.
  {
    name: "/zamowienia",
    run: async () =>
      (await import("@/app/[locale]/zamowienia/page")).default({
        searchParams: Promise.resolve({}),
      }),
  },
  {
    name: "/zamowienia/nowe",
    run: async () => (await import("@/app/[locale]/zamowienia/nowe/page")).default(),
  },
  {
    name: "/zamowienia/[id]",
    run: async () =>
      (await import("@/app/[locale]/zamowienia/[id]/page")).default({
        params: Promise.resolve({ id: ORDER_ID }),
      }),
  },
  // Domeny sklepu (Zadanie 2.6): guard requireMemberPage w stronie.
  {
    name: "/ustawienia-domen",
    run: async () => (await import("@/app/[locale]/ustawienia-domen/page")).default(),
  },
  {
    name: "/admin/tenants",
    run: async () => (await import("@/app/[locale]/(superadmin)/admin/tenants/page")).default(),
  },
  {
    name: "/admin/audit",
    run: async () =>
      (await import("@/app/[locale]/(superadmin)/admin/audit/page")).default({
        searchParams: Promise.resolve({}),
      }),
  },
  {
    name: "/admin/tenants/[id]",
    run: async () =>
      (await import("@/app/[locale]/(superadmin)/admin/tenants/[id]/page")).default({
        params: Promise.resolve({ id: TENANT_ID }),
        searchParams: Promise.resolve({}),
      }),
  },
  {
    name: "/admin/tenants/[id]/podglad",
    run: async () =>
      (await import("@/app/[locale]/(superadmin)/admin/tenants/[id]/podglad/page")).default({
        params: Promise.resolve({ id: TENANT_ID }),
      }),
  },
];

// Bez vi.resetModules(): reset dałby stronom ŚWIEŻY moduł @/lib/auth, a wtedy
// `err instanceof AuthError` w stronach porównywałoby dwie różne klasy o tej
// samej nazwie i nigdy nie trafiało. Moduły nie trzymają tu stanu — locale
// czyta się przez getLocale() przy każdym wywołaniu.
beforeEach(() => {
  currentLocale = "pl";
});

describe.each(["pl", "en"])("chronione trasy — anonim, locale %s", (locale) => {
  beforeEach(() => {
    currentLocale = locale;
  });

  it.each(PROTECTED_ROUTES.map((route) => [route.name, route] as const))(
    "%s odsyła anonima na logowanie w jego języku",
    async (_name, route) => {
      let target: string | null = null;
      try {
        await route.run();
      } catch (error) {
        if (error instanceof RedirectSignal) target = error.url;
        else throw error;
      }

      expect(target, "trasa nie przekierowała anonima — brak guarda?").not.toBeNull();
      expect(target).toMatch(new RegExp(`^/${locale}/login(\\?|$)`));
    },
    // Pierwszy import strony ciągnie za sobą cały łańcuch modułów
    // (@avably/ui itd.) — na runnerze CI potrafi przekroczyć domyślne 5 s.
    15_000,
  );
});
