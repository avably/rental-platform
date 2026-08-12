/**
 * `/reset/confirm` PRZESTAJE BYĆ ŚLEPYM ZAUŁKIEM (ADR-153, N7).
 *
 * Stan zastany: ekran był komponentem KLIENCKIM i rysował formularz ZAWSZE —
 * także bez sesji recovery i po zużytym linku. Człowiek wymyślał hasło,
 * wpisywał je, klikał i DOPIERO wtedy dostawał odmowę, w dodatku bez ani
 * jednego odnośnika, którym można by z tego wyjść („Poproś o nowy link" było
 * zdaniem w komunikacie, nie linkiem).
 *
 * Ta bramka NIE zastępuje bramki w akcji (R14/M-01, ADR-122 — własna suita).
 * Sesja może wygasnąć MIĘDZY renderem a wysłaniem, a akcję da się wywołać
 * z pominięciem tej strony, więc odmowa serwerowa zostaje w mocy. Tutaj
 * mierzony jest MOMENT, w którym człowiek się o niej dowiaduje.
 *
 * OBIE STRONY:
 *   • bez dowodu recovery → ekran odmowy, ZERO pola hasła, DZIAŁAJĄCY link
 *     po nowy link,
 *   • ze świeżym dowodem → formularz (bramka nie jest zamknięta na głucho).
 * Plus: odmowa jest JEDNOLITA — „brak sesji" i „sesja bez dowodu" wyglądają
 * identycznie, więc bramki nie widać z zewnątrz.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl/server", () => ({
  getLocale: async () => "pl",
  getTranslations: async () => (key: string) => key,
}));

/** Claimy zwracane przez getClaims — sterują dowodem recovery. */
let claims: Record<string, unknown> | null = null;

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: async () =>
        claims ? { data: { claims }, error: null } : { data: null, error: { message: "brak" } },
    },
  }),
}));

const { ResetConfirmForm } = await import("@/app/[locale]/(auth)/reset/confirm/form");
const ResetConfirmPage = (await import("@/app/[locale]/(auth)/reset/confirm/page")).default;

const NOW_SECONDS = () => Math.floor(Date.now() / 1000);

/** Sesja o kształcie realnego JWT GoTrue; `amr` sterowane per przypadek. */
function session(amr: unknown): Record<string, unknown> {
  return {
    sub: "u1",
    email: "kto@test.local",
    aal: "aal1",
    app_metadata: { tenant_id: null, role: null, superadmin: false },
    ...(amr === undefined ? {} : { amr }),
  };
}

interface Walked {
  texts: string[];
  hrefs: string[];
  types: unknown[];
  inputNames: string[];
}

function walk(node: unknown, out: Walked): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out);
    return;
  }
  if (typeof node === "string") {
    out.texts.push(node);
    return;
  }
  if (!node || typeof node !== "object") return;
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (el.type !== undefined) out.types.push(el.type);
  if (!el.props) return;
  if (typeof el.props.href === "string") out.hrefs.push(el.props.href);
  if (typeof el.props.name === "string") out.inputNames.push(el.props.name);
  walk(el.props.children, out);
}

async function renderPage(): Promise<Walked> {
  const out: Walked = { texts: [], hrefs: [], types: [], inputNames: [] };
  walk(await ResetConfirmPage(), out);
  return out;
}

beforeEach(() => {
  claims = null;
});

describe("bez dowodu recovery: odmowa PRZED pracą, z wyjściem", () => {
  it("brak sesji → ekran odmowy zamiast formularza", async () => {
    claims = null;

    const { texts, types, hrefs } = await renderPage();

    // Najpierw: ekran odmowy JEST (inaczej „nie ma pola hasła" byłoby puste).
    expect(texts, "ekran odmowy się nie wyrenderował").toContain("expiredTitle");
    expect(types, "formularz nowego hasła wyrenderował się mimo braku sesji").not.toContain(
      ResetConfirmForm,
    );
    expect(hrefs).toContain("/reset");
  });

  it("sesja HASŁOWA (bez dowodu ze skrzynki) → ta sama odmowa", async () => {
    claims = session([{ method: "password", timestamp: NOW_SECONDS() }]);

    const { texts, types } = await renderPage();

    expect(texts).toContain("expiredTitle");
    expect(types).not.toContain(ResetConfirmForm);
  });

  it("dowód PRZETERMINOWANY → odmowa (okno nie rośnie przy odświeżeniu tokenu)", async () => {
    const { RECOVERY_PROOF_MAX_AGE_SECONDS } = await import("@/lib/auth");
    claims = session([
      { method: "otp", timestamp: NOW_SECONDS() - RECOVERY_PROOF_MAX_AGE_SECONDS - 60 },
    ]);

    const { types } = await renderPage();

    expect(types).not.toContain(ResetConfirmForm);
  });

  it("odmowa jest JEDNOLITA — brak sesji wygląda jak sesja bez dowodu", async () => {
    claims = null;
    const withoutSession = await renderPage();

    claims = session([{ method: "password", timestamp: NOW_SECONDS() }]);
    const regularSession = await renderPage();

    expect(regularSession.texts).toEqual(withoutSession.texts);
    expect(regularSession.hrefs).toEqual(withoutSession.hrefs);
  });

  it("„Poproś o nowy link” jest LINKIEM, a nie zdaniem w komunikacie", async () => {
    claims = null;

    const { texts, hrefs } = await renderPage();

    expect(texts).toContain("requestNewLink");
    expect(hrefs, "wyjście z ekranu nie prowadzi nigdzie").toContain("/reset");
    expect(hrefs).toContain("/login");
  });

  it("na ekranie odmowy NIE MA pola hasła — nie ma czego zmarnować", async () => {
    claims = null;

    const { inputNames } = await renderPage();

    expect(inputNames).not.toContain("password");
  });
});

describe("ze świeżym dowodem recovery: formularz wchodzi (kontrola pozytywna)", () => {
  it.each(["otp", "recovery"])("metoda %s → formularz nowego hasła", async (method) => {
    claims = session([{ method, timestamp: NOW_SECONDS() }]);

    const { types, texts } = await renderPage();

    expect(types, "bramka odcięła legalny przepływ resetu").toContain(ResetConfirmForm);
    expect(texts).toContain("title");
    expect(texts).not.toContain("expiredTitle");
  });
});
