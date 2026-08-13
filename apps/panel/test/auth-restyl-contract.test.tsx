// @vitest-environment jsdom

/**
 * Restyling ekranów wejścia (ADR-156) — bramka na trzy rzeczy, które ta
 * zmiana mogła zepsuć, i na jedną, którą miała naprawić.
 *
 * 1. WIDŻET CAPTCHY JEST RENDEROWANY, NIE ZADEKLAROWANY. Zmiana opakowała
 *    `AuthCaptchaField` w slot — czyli dołożyła element między formularz
 *    a widżet. Test patrzy na WYNIK RENDERU: czy host widżetu i kanał tokenu
 *    naprawdę siedzą w slocie. Skan importów przepuściłby dokładnie tę awarię,
 *    przed którą stoi (slot bez zawartości importuje się tak samo dobrze).
 * 2. SLOT TRZYMA MIEJSCE NIEZALEŻNIE OD ŚRODOWISKA. Bez site key widżet
 *    renderuje `null` (anty-lockout, ADR-106) — slot ma zostać, żeby ekran bez
 *    skonfigurowanego klucza miał tę samą geometrię co produkcja.
 * 3. KOMUNIKAT ODMOWY IDZIE NA EKRAN BEZ KLASYFIKACJI. Jednolitość odmów
 *    logowania (ADR-153) mieszka w akcji; warstwa widoku ma go wyłącznie
 *    przepisać. Test podaje formularzowi DWA różne teksty i sprawdza, że oba
 *    wychodzą co do znaku — gdyby widok dorobił własne rozgałęzienie („to
 *    wygląda na niepotwierdzony adres"), ekran znów stałby się wyrocznią.
 * 4. ODNOŚNIKI POD FORMULARZEM STOJĄ W KOLUMNIE. Zgłoszenie właściciela:
 *    „Załóż kontoNie pamiętam hasła" — dwa odnośniki w jednym wierszu
 *    `justify-between`, w kolumnie zwężonej do szerokości treści, stykały się
 *    bez odstępu. Kolumna nie ma jak się skleić przy żadnej szerokości.
 *
 * Wyśrodkowanie widżetu jest ZMIERZONE W PRZEGLĄDARCE (liczby w ADR-156):
 * jsdom nie liczy układu, więc test może pilnować wyłącznie mechanizmu —
 * że slot jest kontenerem centrującym, a host widżetu jego jedynym dzieckiem
 * biorącym udział w układzie.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

let loginResult: { error?: string } = {};

vi.mock("@/app/[locale]/(auth)/login/actions", () => ({
  loginAction: async () => loginResult,
}));
vi.mock("@/app/[locale]/(auth)/register/actions", () => ({
  registerAction: async () => ({}),
}));
vi.mock("@/app/[locale]/(auth)/reset/actions", () => ({
  resetRequestAction: async () => ({}),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  loginResult = {};
  vi.unstubAllEnvs();
  document.head.querySelectorAll("script").forEach((node) => node.remove());
});

/**
 * Formularze auth niosące CAPTCHĘ — ta sama reguła na każdym.
 *
 * Logowanie było tu trzecie do ADR-164; teraz ma własny przypadek niżej,
 * pilnujący, że slotu NIE ma. Wykreślenie go z tej listy bez tamtego
 * przypadku byłoby zdjęciem pokrycia, nie zmianą kontraktu.
 */
const CAPTCHA_SCREENS: Array<[string, () => Promise<React.ReactElement>]> = [
  [
    "rejestracja",
    async () => {
      const { RegisterForm } = await import("@/app/[locale]/(auth)/register/form");
      return <RegisterForm />;
    },
  ],
  [
    "reset hasła",
    async () => {
      const ResetRequestPage = (await import("@/app/[locale]/(auth)/reset/page")).default;
      return <ResetRequestPage />;
    },
  ],
];

function wrap(element: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      {element}
    </NextIntlClientProvider>,
  );
}

describe.each(CAPTCHA_SCREENS)("miejsce na CAPTCHĘ — %s", (_name, load) => {
  it("ze site key: widżet i kanał tokenu są W SLOCIE (wynik renderu, nie import)", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
    vi.resetModules();
    const { container } = wrap(await load());

    const slot = container.querySelector("[data-auth-captcha-slot]");
    expect(slot, "formularz stracił miejsce na CAPTCHĘ").not.toBeNull();

    // Kanał tokenu do akcji serwerowej — MUSI stać w slocie, nie obok.
    const token = slot!.querySelector('input[name="turnstileToken"]');
    expect(token, "kanał tokenu wypadł ze slotu — akcja nie dostanie CAPTCHY").not.toBeNull();

    // Host widżetu: element, w którym dostawca rysuje iframe 300 px. To on
    // ma być dzieckiem centrowanego kontenera — ukryty input nie zajmuje
    // miejsca w układzie i nie da się na nim niczego wyśrodkować.
    const layoutChildren = [...slot!.children].filter(
      (child) => !(child instanceof HTMLInputElement && child.type === "hidden"),
    );
    expect(
      layoutChildren.length,
      "slot ma inną liczbę dzieci układu niż jedno — wyśrodkowanie przestaje być jednoznaczne",
    ).toBe(1);
  });

  it("slot jest kontenerem CENTRUJĄCYM, nie zwykłym pudełkiem", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
    vi.resetModules();
    const { container } = wrap(await load());

    const slot = container.querySelector("[data-auth-captcha-slot]")!;
    // Widżet ma STAŁĄ szerokość 300 px, a kolumna 416 px — bez centrowania
    // stoi 58 px w lewo od osi pól (zmierzone, ADR-156). `text-align` nic tu
    // nie robi: iframe to element blokowy, a nie tekst.
    expect(slot.className).toContain("flex");
    expect(slot.className).toContain("justify-center");
    // Rezerwacja wysokości — bez niej przycisk skacze w chwili doładowania.
    expect(slot.className).toContain("min-h-18");
  });

  it("bez site key slot ZOSTAJE, a kanału tokenu nie ma (ta sama geometria)", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    vi.resetModules();
    const { container } = wrap(await load());

    expect(
      container.querySelector("[data-auth-captcha-slot]"),
      "miejsce na CAPTCHĘ znika razem z widżetem — układ zależy od środowiska",
    ).not.toBeNull();
    expect(container.querySelector('input[name="turnstileToken"]')).toBeNull();
    expect(
      document.head.querySelector('script[src^="https://challenges.cloudflare.com/"]'),
      "CAPTCHA wyłączona, a formularz i tak bije w skrypt dostawcy",
    ).toBeNull();
  });
});

/**
 * LOGOWANIE PO ADR-164: nie ma widżetu i NIE MA PO NIM LUKI.
 *
 * Rezerwacja `min-h-18` (72 px) z ADR-156 stała ZAWSZE, niezależnie od site
 * key — to była jej cała zaleta. Po zdjęciu CAPTCHY z logowania ta sama
 * właściwość staje się usterką: pusty pas między hasłem a przyciskiem,
 * którego nic już nie tłumaczy. Dlatego mierzone jest jedno i drugie —
 * brak kanału tokenu ORAZ brak rezerwacji miejsca.
 */
describe("ekran logowania: ani widżetu, ani luki po nim (ADR-164)", () => {
  it("ze site key USTAWIONYM nie ma slotu, kanału tokenu ani skryptu dostawcy", async () => {
    // Site key ustawiony celowo: bez niego widżet i tak renderuje `null`,
    // więc asercja przechodziłaby także po cichym powrocie CAPTCHY.
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
    vi.resetModules();
    const { LoginForm } = await import("@/app/[locale]/(auth)/login/form");
    const { container } = wrap(<LoginForm />);

    expect(
      container.querySelector("[data-auth-captcha-slot]"),
      "rezerwacja 72 px została po widżecie — na ekranie jest pusta luka",
    ).toBeNull();
    expect(container.querySelector('input[name="turnstileToken"]')).toBeNull();
    expect(
      document.head.querySelector('script[src^="https://challenges.cloudflare.com/"]'),
    ).toBeNull();
  });

  it("KONTROLA POZYTYWNA: rejestracja w tym samym harnessie slot MA", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
    vi.resetModules();
    const { RegisterForm } = await import("@/app/[locale]/(auth)/register/form");
    const { container } = wrap(<RegisterForm />);

    expect(container.querySelector("[data-auth-captcha-slot]")).not.toBeNull();
  });
});

describe("ekran logowania: widok przepisuje odmowę, nie klasyfikuje jej", () => {
  async function submitLogin(error: string) {
    loginResult = { error };
    vi.resetModules();
    const { LoginForm } = await import("@/app/[locale]/(auth)/login/form");
    const { container } = wrap(<LoginForm />);
    const form = container.querySelector("form")!;
    fireEvent.change(container.querySelector<HTMLInputElement>("input[name='email']")!, {
      target: { value: "kto@test.local" },
    });
    fireEvent.change(container.querySelector<HTMLInputElement>("input[name='password']")!, {
      target: { value: "Haslo!12345678" },
    });
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });
    return container;
  }

  it("tekst odmowy wychodzi na ekran CO DO ZNAKU, dla dwóch różnych treści", async () => {
    const first = await submitLogin(messages.login.signInFailed);
    const firstBlock = first.querySelector("[data-login-error]");
    expect(firstBlock, "formularz nie pokazał bloku odmowy").not.toBeNull();
    expect(firstBlock!.querySelector("p")!.textContent).toBe(messages.login.signInFailed);

    cleanup();

    // Drugi tekst to DRUGA REALNA odmowa tej akcji — odcięcie limitem.
    // (Do ADR-164 stała tu odmowa CAPTCHY; logowanie już jej nie produkuje.)
    const second = await submitLogin(messages.authError.tooManyRequests);
    const secondBlock = second.querySelector("[data-login-error]");
    expect(secondBlock!.querySelector("p")!.textContent).toBe(messages.authError.tooManyRequests);
  });

  it("odmowa dalej jest ogłaszana czytnikowi (role=alert)", async () => {
    const container = await submitLogin(messages.login.signInFailed);

    expect(screen.getByRole("alert").textContent).toContain(messages.login.signInFailed);
    expect(container.querySelector("[data-login-error]")).not.toBeNull();
  });
});

describe("odnośniki pod formularzem stoją w KOLUMNIE (zgłoszenie właściciela)", () => {
  it("logowanie: kontener odnośników jest kolumną z odstępem", async () => {
    vi.resetModules();
    const { LoginForm } = await import("@/app/[locale]/(auth)/login/form");
    const { container } = wrap(<LoginForm />);

    const links = container.querySelector("[data-auth-links]");
    expect(links, "ekran stracił blok odnośników").not.toBeNull();
    // Wiersz `justify-between` w wąskiej kolumnie sklejał „Załóż konto"
    // z „Nie pamiętam hasła" w jeden ciąg. Kolumna nie ma jak tego zrobić.
    expect(links!.className).toContain("flex-col");
    expect(links!.className).toMatch(/\bgap-\d/);
    expect(links!.className, "odnośniki wróciły do wiersza").not.toContain("justify-between");
    // Kontrola pozytywna: w bloku naprawdę stoi wyjście, nie zero. JEDNO —
    // „Nie dostałeś maila potwierdzającego?" zeszło stąd w ADR-164 i to jest
    // liczba do świadomej zmiany, nie do dopasowania po czerwieni.
    expect(links!.children.length).toBe(1);
    expect(links!.textContent).toContain(messages.login.register);
  });

  it("logowanie: pytanie o mail potwierdzający zeszło ze STAŁYCH odnośników (ADR-164)", async () => {
    vi.resetModules();
    const { LoginForm } = await import("@/app/[locale]/(auth)/login/form");
    const { container } = wrap(<LoginForm />);

    const links = container.querySelector("[data-auth-links]")!;
    const hrefs = [...links.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(
      hrefs,
      "stały odnośnik do skrzynki wrócił na ekran logowania (decyzja właściciela, ADR-164)",
    ).not.toContain("/register/sprawdz-skrzynke");

    // KONTROLA POZYTYWNA na tej samej powierzchni: rejestracja ten odnośnik
    // ma dalej — czyli asercja wyżej mierzy decyzję, a nie martwy selektor.
    cleanup();
    vi.resetModules();
    const { RegisterForm } = await import("@/app/[locale]/(auth)/register/form");
    const { container: registerContainer } = wrap(<RegisterForm />);
    const registerHrefs = [
      ...registerContainer.querySelector("[data-auth-links]")!.querySelectorAll("a"),
    ].map((a) => a.getAttribute("href"));
    expect(registerHrefs).toContain("/register/sprawdz-skrzynke");
  });

  it("rejestracja: ten sam kontener, ta sama reguła", async () => {
    vi.resetModules();
    const { RegisterForm } = await import("@/app/[locale]/(auth)/register/form");
    const { container } = wrap(<RegisterForm />);

    const links = container.querySelector("[data-auth-links]")!;
    expect(links.className).toContain("flex-col");
    expect(links.children.length).toBe(2);
  });
});
