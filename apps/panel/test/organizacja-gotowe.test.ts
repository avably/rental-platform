/**
 * POTWIERDZENIE ZAŁOŻENIA ORGANIZACJI (ADR-153, N5c).
 *
 * Do tej naprawy `createTenantAction` kończyła nagim `redirect("/")`. W tej
 * jednej sekundzie spełniają się DWIE najmocniejsze obietnice produktu —
 * rusza 14-dniowy okres próbny i rejestruje się publiczny adres sklepu
 * `nazwa.avably.io` — i obie spełniały się WYŁĄCZNIE w bazie: człowiek
 * lądował na pulpicie i nie dowiadywał się o żadnej.
 *
 * Test pilnuje, że ekran mówi obie rzeczy PRAWDZIWYMI wartościami:
 *   • adres sklepu policzony z sluga tenanta (ta sama funkcja co rejestracja
 *     domeny), a nie sklejony na miejscu,
 *   • data końca okresu próbnego wzięta z `tenants.trial_ends_at` (0066,
 *     ADR-135) — nie z „dziś + 14", bo zegar ma JEDNO źródło prawdy.
 * Plus dwie strony guardu: bez organizacji nie ma tu czego oglądać.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`REDIRECT:${url}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
  permanentRedirect: (url: string) => {
    throw new RedirectSignal(url);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

vi.mock("next-intl/server", () => ({
  getLocale: async () => "pl",
  // Echo klucza z argumentami — asercje mierzą, KTÓRY klucz i z JAKĄ
  // wartością trafił na ekran, niezależnie od redakcji tekstu.
  getTranslations: async () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${Object.values(values).join("|")}` : key,
}));

interface TenantRow {
  name: string;
  slug: string;
  trial_ends_at: string | null;
}

let tenantRow: TenantRow | null = null;
let memberMissing = false;
let selectedColumns = "";

vi.mock("@/lib/member-page", () => ({
  requireMemberPage: async () => {
    if (memberMissing) throw new RedirectSignal("/pl/");
    return {
      tenantId: "00000000-0000-4000-8000-000000000009",
      supabase: {
        from: () => ({
          select: (columns: string) => {
            selectedColumns = columns;
            return {
              eq: () => ({ maybeSingle: async () => ({ data: tenantRow, error: null }) }),
            };
          },
        }),
      },
    };
  },
}));

const TenantCreatedPage = (
  await import("@/app/[locale]/(panel)/organizacja/nowa/gotowe/page")
).default;

function walk(node: unknown, out: { texts: string[]; hrefs: string[] }): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out);
    return;
  }
  if (typeof node === "string") {
    out.texts.push(node);
    return;
  }
  if (!node || typeof node !== "object") return;
  const props = (node as { props?: Record<string, unknown> }).props;
  if (!props) return;
  if (typeof props.href === "string") out.hrefs.push(props.href);
  walk(props.children, out);
}

async function renderPage(): Promise<{ texts: string[]; hrefs: string[] }> {
  const out = { texts: [] as string[], hrefs: [] as string[] };
  walk(await TenantCreatedPage(), out);
  return out;
}

beforeEach(() => {
  memberMissing = false;
  selectedColumns = "";
  tenantRow = {
    name: "Wypożyczalnia Bałtyk",
    slug: "wypozyczalnia-baltyk",
    trial_ends_at: "2026-08-26T12:00:00.000Z",
  };
});

describe("ekran potwierdzenia mówi, co się właśnie stało", () => {
  it("pokazuje ADRES SKLEPU zbudowany ze sluga organizacji", async () => {
    const { texts, hrefs } = await renderPage();

    expect(texts, "adres sklepu nie trafił na ekran").toContain("wypozyczalnia-baltyk.avably.io");
    expect(hrefs).toContain("https://wypozyczalnia-baltyk.avably.io");
  });

  it("pokazuje DATĘ końca okresu próbnego z kolumny tenants.trial_ends_at", async () => {
    const { texts } = await renderPage();

    const trial = texts.find((text) => text.startsWith("trialValue:"));
    expect(trial, "data końca okresu próbnego nie trafiła na ekran").toBeTruthy();
    // 26 sierpnia 2026 w strefie Europe/Warsaw — data z BAZY, nie „dziś + 14".
    expect(trial).toContain("26");
    expect(trial).toContain("2026");
  });

  it("czyta DOKŁADNIE te kolumny, których potrzebuje (bez nadmiarowego odczytu)", async () => {
    await renderPage();

    expect(selectedColumns).toBe("name, slug, trial_ends_at");
  });

  it("prowadzi dalej — do panelu", async () => {
    const { hrefs } = await renderPage();

    expect(hrefs).toContain("/");
  });

  it("brak zegara triala gasi CAŁY wiersz zamiast pokazywać myślnik", async () => {
    tenantRow = { name: "Bez zegara", slug: "bez-zegara", trial_ends_at: null };

    const { texts } = await renderPage();

    // Kontrola: ekran się wyrenderował (adres jest), ale wiersza triala nie ma.
    expect(texts).toContain("bez-zegara.avably.io");
    expect(texts.some((text) => text.startsWith("trialValue:"))).toBe(false);
    expect(texts).not.toContain("trialLabel");
  });
});

describe("guard ekranu potwierdzenia", () => {
  it("sesja bez organizacji nie ma tu czego oglądać — wraca na pulpit", async () => {
    memberMissing = true;

    await expect(renderPage()).rejects.toMatchObject({ url: "/pl/" });
  });

  it("guard wpuścił, ale RLS nic nie oddało → 404, nie pusty szkielet", async () => {
    tenantRow = null;

    await expect(renderPage()).rejects.toThrow("NOT_FOUND");
  });
});
