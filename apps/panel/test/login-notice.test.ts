/**
 * Komunikat powrotu na ekranie logowania (ADR-153, N2).
 *
 * Dwa najczęstsze realne przejścia panelu kończyły się CISZĄ na gołym
 * formularzu, mimo że oba niosły w adresie gotową informację:
 *   • `/auth/confirm` przy wygasłym/zużytym linku → `/login?error=link_expired`
 *     (klucz `authError.linkExpired` był napisany i PRZETŁUMACZONY w obu
 *     locale — nikt go nie wyświetlał),
 *   • udana zmiana hasła → `/login?reset=ok` i zero potwierdzenia.
 *
 * Test mierzy OBIE STRONY:
 *   1. parametr Z ALLOWLISTY dociera na ekran jako TREŚĆ (nie sam fakt
 *      istnienia elementu — najpierw potwierdzamy, że blok komunikatu JEST,
 *      potem sprawdzamy, co w nim stoi),
 *   2. parametr SPOZA allowlisty NIE tworzy komunikatu i jego wartość NIE
 *      pojawia się nigdzie w drzewie — ekran logowania nie jest tablicą
 *      ogłoszeniową dla kogoś, kto podeśle spreparowany link.
 *
 * `getTranslations` jest zamockowane echem klucza, więc asercje mierzą, KTÓRY
 * klucz trafił na ekran (a nie brzmienie, które wolno redagować).
 */
import { describe, expect, it, vi } from "vitest";

import { loginNotice } from "@/lib/auth-notice";

vi.mock("next-intl/server", () => ({
  getLocale: async () => "pl",
  getTranslations: async () => (key: string) => key,
}));

// Formularz logowania ciągnie akcję serwerową (Supabase, limity, CAPTCHA) —
// dla tego testu jest wyłącznie elementem drzewa, więc podmieniamy go atrapą.
vi.mock("@/app/[locale]/(auth)/login/form", () => ({
  LoginForm: () => null,
}));

const LoginPage = (await import("@/app/[locale]/(auth)/login/page")).default;

interface Walked {
  texts: string[];
  /** Tony komunikatów — tylko wartości poprawne (string). */
  noticeTones: string[];
  /**
   * OBECNOŚĆ bloku komunikatu, niezależna od wartości tonu.
   *
   * Liczona przez `"data-login-notice" in props`, a NIE przez `typeof tone
   * === "string"` — i to jest cała różnica. Przy dziurze prototypowej strona
   * renderowała blok komunikatu z tonem `undefined`; detektor po typie
   * wartości takiego bloku NIE WIDZIAŁ, więc test „nie ma komunikatu"
   * przechodził nad zepsutym renderem. Obecność łapie jedno i drugie.
   */
  noticeBlocks: number;
}

/** Teksty i komunikaty z drzewa elementów Server Componentu. */
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
  const el = node as { props?: Record<string, unknown> };
  if (!el.props) return;
  if ("data-login-notice" in el.props) {
    out.noticeBlocks += 1;
    const tone = el.props["data-login-notice"];
    if (typeof tone === "string") out.noticeTones.push(tone);
  }
  walk(el.props.children, out);
}

async function renderLogin(params: Record<string, string | string[]>): Promise<Walked> {
  const out: Walked = { texts: [], noticeTones: [], noticeBlocks: 0 };
  walk(await LoginPage({ searchParams: Promise.resolve(params) }), out);
  return out;
}

describe("loginNotice — allowlista parametrów, nie odbicie", () => {
  it("kody linku z /auth/confirm dają komunikat o wygasłym linku", () => {
    expect(loginNotice({ error: "link_expired" })).toEqual({
      tone: "error",
      messageKey: "authError.linkExpired",
    });
    expect(loginNotice({ error: "invalid_link" })).toEqual({
      tone: "error",
      messageKey: "authError.linkExpired",
    });
  });

  it("`reset=ok` daje potwierdzenie zmiany hasła", () => {
    expect(loginNotice({ reset: "ok" })).toEqual({
      tone: "success",
      messageKey: "login.resetDone",
    });
  });

  it("brak parametrów i wartości spoza allowlisty dają BRAK komunikatu", () => {
    expect(loginNotice({})).toBeNull();
    expect(loginNotice({ error: "cokolwiek" })).toBeNull();
    expect(loginNotice({ reset: "nie-ok" })).toBeNull();
    expect(loginNotice({ error: "<b>uwaga</b>" })).toBeNull();
  });

  it("sukces wygrywa z zaległym błędem w tym samym adresie", () => {
    expect(loginNotice({ error: "link_expired", reset: "ok" })?.tone).toBe("success");
  });

  /**
   * KLUCZE Z ŁAŃCUCHA PROTOTYPÓW (recenzja PM, ADR-153).
   *
   * Pierwsza wersja odpytywała allowlistę przez `NOTICES[error]` na zwykłym
   * literale obiektu. Taki odczyt schodzi po prototypie, więc przechodziło
   * pięć nazw, których nikt na listę nie wpisał — `/login?error=constructor`
   * dostawało funkcję `Object` udającą komunikat, a strona robiła na niej
   * `notice.tone` i `t(notice.messageKey)`, czyli tłumaczenie z kluczem
   * `undefined`. Sterowane WPROST adresem URL, na publicznej stronie.
   *
   * Rejestry są dziś `Map`, więc dziura jest zamknięta KONSTRUKCYJNIE. Ten
   * test istnieje, żeby powrót do literału obiektu spalił bramkę, a nie żeby
   * przypominać o strażniku.
   */
  const PROTOTYPE_KEYS = [
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "__proto__",
  ] as const;

  it.each(PROTOTYPE_KEYS)("klucz prototypu „%s” w ?error= NIE przechodzi allowlisty", (key) => {
    expect(
      loginNotice({ error: key }),
      `allowlista przepuściła klucz z prototypu: ${key}`,
    ).toBeNull();
  });

  it.each(PROTOTYPE_KEYS)("klucz prototypu „%s” w ?reset= NIE przechodzi allowlisty", (key) => {
    expect(
      loginNotice({ reset: key }),
      `allowlista przepuściła klucz z prototypu: ${key}`,
    ).toBeNull();
  });

  it("KONTROLA POZYTYWNA: prawdziwe kody dalej działają (allowlista nie jest głucha)", () => {
    // Bez tego asercje wyżej byłyby zielone także dla funkcji, która ZAWSZE
    // zwraca null — czyli dowód po pustym zbiorze.
    expect(loginNotice({ error: "link_expired" })?.messageKey).toBe("authError.linkExpired");
    expect(loginNotice({ error: "invalid_link" })?.messageKey).toBe("authError.linkExpired");
    expect(loginNotice({ reset: "ok" })?.messageKey).toBe("login.resetDone");
  });

  it("powtórzony parametr (tablica) czytany jest po pierwszej wartości", () => {
    expect(loginNotice({ error: ["link_expired", "cokolwiek"] })?.messageKey).toBe(
      "authError.linkExpired",
    );
    expect(loginNotice({ error: ["cokolwiek", "link_expired"] })).toBeNull();
  });
});

describe("ekran logowania WYŚWIETLA komunikat (a nie tylko go zna)", () => {
  it("`?error=link_expired` → blok błędu z kluczem authError.linkExpired", async () => {
    const { texts, noticeTones } = await renderLogin({ error: "link_expired" });

    // Najpierw: blok komunikatu JEST na ekranie…
    expect(noticeTones, "ekran logowania nie wyrenderował komunikatu powrotu").toEqual(["error"]);
    // …dopiero potem: co w nim stoi.
    expect(texts).toContain("authError.linkExpired");
  });

  it("`?reset=ok` → blok potwierdzenia z kluczem login.resetDone", async () => {
    const { texts, noticeTones } = await renderLogin({ reset: "ok" });

    expect(noticeTones).toEqual(["success"]);
    expect(texts).toContain("login.resetDone");
  });

  it("gołe /login nie pokazuje żadnego komunikatu (kontrola negatywna)", async () => {
    const { texts, noticeTones, noticeBlocks } = await renderLogin({});

    expect(noticeBlocks).toBe(0);
    expect(noticeTones).toEqual([]);
    expect(texts).not.toContain("authError.linkExpired");
    expect(texts).not.toContain("login.resetDone");
  });

  /**
   * To jest miejsce, w którym dziura prototypowa naprawdę bolała: strona robi
   * `notice.tone` i `tRoot(notice.messageKey)`. Dla funkcji `Object` oba są
   * `undefined`, więc na publicznym ekranie logowania leciało tłumaczenie
   * z pustym kluczem. Mierzymy więc SKUTEK na ekranie, nie tylko wynik
   * funkcji — i to na wszystkich pięciu nazwach.
   */
  it.each(["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"])(
    "`?error=%s` nie tworzy komunikatu i nie wywraca renderu strony",
    async (key) => {
      const { noticeBlocks, noticeTones, texts } = await renderLogin({ error: key });

      // Kontrola, że strona w ogóle się wyrenderowała — inaczej „brak
      // komunikatu" byłby prawdą również dla wyjątku w renderze.
      expect(texts).toContain("title");
      // OBECNOŚĆ bloku, nie wartość tonu: przy dziurze prototypowej blok
      // powstawał z tonem `undefined`, więc detektor po typie go nie widział.
      expect(noticeBlocks, `klucz z prototypu wyprodukował blok komunikatu: ${key}`).toBe(0);
      expect(noticeTones).toEqual([]);
      expect(texts.join(" ")).not.toContain(key);
    },
  );

  it("wartość spoza allowlisty NIE trafia na ekran — zero odbicia parametru", async () => {
    const injected = "KONTO-NIE-ISTNIEJE-<script>";
    const { texts, noticeTones, noticeBlocks } = await renderLogin({ error: injected });

    expect(noticeBlocks, "nieznany kod błędu wyprodukował blok komunikatu").toBe(0);
    expect(noticeTones).toEqual([]);
    expect(
      texts.join(" "),
      "treść parametru adresu wyciekła na ekran logowania",
    ).not.toContain(injected);
  });
});
