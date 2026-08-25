// @vitest-environment jsdom

/**
 * „OPUBLIKOWANA" A „OPUBLIKOWANA + ZMIANY W SZKICU" (K-05) ORAZ DROGA PO
 * UTWORZENIU STRONY (K-02) — audyt UX 2026-08-25.
 *
 * ===================== DWIE WADY, KTÓRE TEN PLIK ZAMYKA =====================
 *
 *   1. K-05: lista stron miała JEDNĄ odznakę na DWA stany. „Opublikowana"
 *      świeciło tak samo nad stroną wypuszczoną co do przecinka i nad stroną,
 *      w której operator przestawił pół płótna. Ten drugi stan jest ważniejszy
 *      — to jedyny, w którym trzeba coś zrobić — i był niewidoczny. Operator
 *      wychodził z kreatora („Zapisano"), patrzył na listę („opublikowana")
 *      i miał komplet sygnałów mówiących, że skończył;
 *   2. K-02: „Utwórz stronę" zostawiało go NA LIŚCIE, przy pustym wierszu.
 *      Czasownik obiecuje stronę, więc ma prowadzić tam, gdzie się ją robi.
 *
 * ===================== CO JEST MIERZONE =====================
 *
 * `draftPending` jest funkcją CZYSTĄ i ma dowody kolumna po kolumnie, razem
 * z KONTROLĄ NEGATYWNĄ (stan tuż po publikacji nie jest różnicą). Odznaka
 * i nawigacja — na prawdziwym komponencie listy.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import plMessages from "../messages/pl.json";

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

const actions = vi.hoisted(() => ({
  createSite: vi.fn(),
  deleteSite: vi.fn(),
  publishSite: vi.fn(),
  unpublishSite: vi.fn(),
  renameSite: vi.fn(),
}));
const push = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/site", () => actions);
vi.mock("@/lib/actions/site-product-exception", () => ({
  forkProductPage: vi.fn(),
  restoreDefaultProductPage: vi.fn(),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
}));

const { draftPending } = await import("@/app/[locale]/(panel)/strona/draft-state");
const { SitePages } = await import("@/app/[locale]/(panel)/strona/site-pages");

type Row = Parameters<typeof SitePages>[0]["rows"][number];

const SITE_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const NOWA_ID = "bbbbbbbb-2222-4222-8222-222222222222";

/* ====================== CZĘŚĆ 1: FUNKCJA CZYSTA ====================== */

const STRONA = { slug: "", slug_published: "" };

/** Sekcja TUŻ PO PUBLIKACJI — bliźniak równy szkicowi, kolumna po kolumnie. */
function opublikowana(content: unknown = { heading: "Wypożyczalnia" }) {
  return {
    content_draft: content,
    content_published: content,
    position: 0,
    position_published: 0,
    enabled: true,
    enabled_published: true,
    deleted_in_draft: false,
  };
}

describe("K-05: draftPending odpowiada kolumną, a nie zegarem", () => {
  it("KONTROLA NEGATYWNA: tuż po publikacji nie ma czego publikować", () => {
    expect(draftPending(STRONA, [opublikowana(), opublikowana({ heading: "Cennik" })])).toBe(false);
  });

  it("ta sama treść w innej KOLEJNOŚCI kluczy nie jest różnicą", () => {
    // jsonb oddaje klucze kanonicznie, ale porównanie i tak ma iść po
    // strukturze — `JSON.stringify` odpowiadałby na inne pytanie.
    expect(
      draftPending(STRONA, [
        {
          ...opublikowana(),
          content_draft: { heading: "A", body: "B" },
          content_published: { body: "B", heading: "A" },
        },
      ]),
    ).toBe(false);
  });

  it("zmieniona TREŚĆ jest różnicą", () => {
    expect(
      draftPending(STRONA, [
        { ...opublikowana(), content_draft: { heading: "Nowy nagłówek" } },
      ]),
    ).toBe(true);
  });

  it("sekcja NIGDY nieopublikowana jest różnicą", () => {
    expect(
      draftPending(STRONA, [
        { ...opublikowana(), content_published: null, position_published: null, enabled_published: null },
      ]),
    ).toBe(true);
  });

  it("przestawiona KOLEJNOŚĆ jest różnicą", () => {
    expect(draftPending(STRONA, [{ ...opublikowana(), position: 3 }])).toBe(true);
  });

  it("wyłączenie sekcji jest różnicą", () => {
    expect(draftPending(STRONA, [{ ...opublikowana(), enabled: false }])).toBe(true);
  });

  it("sekcja skasowana w szkicu jest różnicą — u klienta jeszcze stoi", () => {
    expect(draftPending(STRONA, [{ ...opublikowana(), deleted_in_draft: true }])).toBe(true);
  });

  it("zmieniony ADRES jest różnicą, choćby treść stała w miejscu", () => {
    expect(draftPending({ slug: "kontakty", slug_published: "kontakt" }, [opublikowana()])).toBe(
      true,
    );
  });

  it("strona bez ani jednej sekcji i bez zmiany adresu nie ma różnicy", () => {
    expect(draftPending(STRONA, [])).toBe(false);
  });
});

/* ====================== CZĘŚĆ 2: LISTA STRON ====================== */

function wiersz(overrides: Partial<Row> = {}): Row {
  return {
    id: SITE_ID,
    name: "Strona główna",
    live: true,
    kind: "page",
    slug: "",
    slugPublished: "",
    redirectOldSlug: false,
    redirectedFrom: [],
    productId: null,
    productName: null,
    publishedAtLabel: "25.08.2026, 10:00",
    createdAtLabel: "01.08.2026, 10:00",
    draftPending: false,
    warnings: [],
    ...overrides,
  } as Row;
}

function renderList(rows: Row[]) {
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <SitePages rows={rows} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  push.mockReset();
  for (const action of Object.values(actions)) action.mockReset();
  actions.createSite.mockResolvedValue({ ok: true, siteId: NOWA_ID });
});

afterEach(() => cleanup());

describe("K-05: odznaka niedopublikowanych zmian", () => {
  it("strona ŻYWA ze zmianami w szkicu dostaje odznakę OBOK chipu publikacji", () => {
    const { container } = renderList([wiersz({ draftPending: true })]);
    const odznaka = container.querySelector<HTMLElement>("[data-site-page-draft-pending]");
    expect(odznaka, "brak odznaki niedopublikowanych zmian").not.toBeNull();
    expect(odznaka!.textContent).toBe(plMessages.site.pages.draftPendingBadge);
    // Chip „opublikowana" ZOSTAJE — oba zdania są prawdziwe naraz.
    expect(container.querySelector('[data-site-page-live="on"]')).not.toBeNull();
    expect(container.textContent).toContain(plMessages.site.pages.draftPendingBody);
  });

  it("publikacja staje się czynnością GŁÓWNĄ tego wiersza", () => {
    const { container } = renderList([wiersz({ draftPending: true })]);
    expect(
      container.querySelector<HTMLElement>("[data-publish-site]")!.dataset.publishSiteEmphasis,
    ).toBe("on");
  });

  it("strona wypuszczona co do przecinka odznaki NIE dostaje", () => {
    const { container } = renderList([wiersz({ draftPending: false })]);
    expect(container.querySelector("[data-site-page-draft-pending]")).toBeNull();
    expect(
      container.querySelector<HTMLElement>("[data-publish-site]")!.dataset.publishSiteEmphasis,
    ).toBe("off");
  });

  it("NIEUDANY ODCZYT (null) nie udaje ani jednego, ani drugiego", () => {
    const { container } = renderList([wiersz({ draftPending: null })]);
    expect(container.querySelector("[data-site-page-draft-pending]")).toBeNull();
    expect(
      container.querySelector<HTMLElement>("[data-publish-site]")!.dataset.publishSiteEmphasis,
    ).toBe("off");
  });
});

describe("K-02: utworzenie strony prowadzi do kreatora", () => {
  it("po udanym utworzeniu operator ląduje w kreatorze NOWEJ strony", async () => {
    renderList([wiersz()]);

    fireEvent.click(screen.getByRole("button", { name: plMessages.site.pages.new }));
    fireEvent.change(await screen.findByLabelText(plMessages.site.pages.nameLabel), {
      target: { value: "Kontakt" },
    });
    fireEvent.change(screen.getByLabelText(plMessages.site.pages.slugLabel), {
      target: { value: "kontakt" },
    });
    fireEvent.click(screen.getByRole("button", { name: plMessages.site.pages.newConfirm }));

    await waitFor(() => expect(actions.createSite).toHaveBeenCalled());
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/strona/${NOWA_ID}/kreator`));
  });

  it("odmowa NIE nawiguje — operator zostaje przy formularzu z komunikatem", async () => {
    actions.createSite.mockResolvedValue({ ok: false, error: "Adres jest zajęty." });
    renderList([wiersz()]);

    fireEvent.click(screen.getByRole("button", { name: plMessages.site.pages.new }));
    fireEvent.change(await screen.findByLabelText(plMessages.site.pages.nameLabel), {
      target: { value: "Kontakt" },
    });
    fireEvent.change(screen.getByLabelText(plMessages.site.pages.slugLabel), {
      target: { value: "kontakt" },
    });
    fireEvent.click(screen.getByRole("button", { name: plMessages.site.pages.newConfirm }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Adres jest zajęty."));
    expect(push).not.toHaveBeenCalled();
  });
});
