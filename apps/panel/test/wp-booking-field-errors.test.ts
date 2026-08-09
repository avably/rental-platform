// @vitest-environment jsdom
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Doręczanie błędów pól we wtyczce WordPress (`assets/booking.js`,
 * `showFieldErrors`) — znalezisko #6.
 *
 * Wtyczka ma tylko testy PHP, ale `showFieldErrors` to logika DOM w JS. Ładujemy
 * plik wtyczki 1:1 w jsdom (żeby suita CI panelu go pilnowała) i sprawdzamy
 * inwariant: komunikat bez kotwicy w DOM (klucz zbiorczy `customFields` albo
 * `cf_<id>` pola pominiętego przez renderer) trafia do BANERA ogólnego, a nie
 * przepada zostawiając „sprawdź podświetlone pola", których nie ma.
 */

/**
 * Ścieżkę liczymy szukając w górę od cwd — w środowisku jsdom `import.meta.url`
 * nie jest schematem `file:`, więc `fileURLToPath` by rzucił. cwd bywa apps/panel
 * (turbo) albo korzeniem repo; wyszukiwanie w górę działa w obu.
 */
function findRepoFile(relative: string): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, relative);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Nie znaleziono ${relative} w górę od ${process.cwd()}`);
}

const BOOKING_JS = readFileSync(
  findRepoFile("integrations/wordpress/avably-booking/assets/booking.js"),
  "utf8",
);

const CF_KNOWN = "cf_11111111-1111-4111-8111-111111111111";

function mountDom(): void {
  document.body.innerHTML = `
    <div data-avably-product="2a2a2a2a-1111-4222-8333-444444444444">
      <form data-avably-form>
        <div class="avably-booking__notice" data-avably-notice hidden role="alert"></div>
        <div class="avably-booking__field">
          <input data-avably-field="${CF_KNOWN}" name="${CF_KNOWN}">
          <span class="avably-booking__field-error" data-avably-error-for="avably-cf-known" hidden></span>
        </div>
        <button type="submit" data-avably-submit>Rezerwuj</button>
      </form>
    </div>`;
}

function loadPlugin(): void {
  // Plik jest IIFE — uruchamiamy go raz w globalnym zakresie jsdom
  // (window/document/fetch są globalne).
  new Function(BOOKING_JS)();
}

let fetchResponse: unknown;

beforeEach(() => {
  mountDom();
  (window as unknown as { avablyBooking: unknown }).avablyBooking = {
    ajaxUrl: "/wp-admin/admin-ajax.php",
    nonce: "test-nonce",
    i18n: { submitting: "Wysyłanie…", genericError: "Coś poszło nie tak." },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ json: () => Promise.resolve(fetchResponse) })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function submitAndFlush(): Promise<void> {
  const form = document.querySelector("[data-avably-form]") as HTMLFormElement;
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  // Dwie rundy mikro/makro-zadań: fetch → response.json() → callback.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("booking.js showFieldErrors — doręczenie błędu", () => {
  it("komunikat pod kluczem BEZ kotwicy (`customFields`) trafia do banera, nie przepada (#6)", async () => {
    fetchResponse = {
      success: false,
      data: {
        message: "Sprawdź podświetlone pola.",
        fields: { customFields: "Odpowiedzi są za długie." },
      },
    };
    loadPlugin();
    await submitAndFlush();

    const notice = document.querySelector("[data-avably-notice]") as HTMLElement;
    expect(notice.hidden).toBe(false);
    // Osierocony komunikat DOPISANY do banera ogólnego.
    expect(notice.textContent).toContain("Odpowiedzi są za długie.");
    expect(notice.textContent).toContain("Sprawdź podświetlone pola.");
  });

  it("klucz Z kotwicą nadal trafia pod pole, a osierocony jednocześnie do banera", async () => {
    fetchResponse = {
      success: false,
      data: {
        message: "Popraw formularz.",
        fields: {
          [CF_KNOWN]: "To pole jest wymagane.",
          customFields: "Mapa pól jest za duża.",
        },
      },
    };
    loadPlugin();
    await submitAndFlush();

    const slot = document.querySelector("[data-avably-error-for='avably-cf-known']") as HTMLElement;
    expect(slot.hidden).toBe(false);
    expect(slot.textContent).toBe("To pole jest wymagane.");

    const notice = document.querySelector("[data-avably-notice]") as HTMLElement;
    expect(notice.textContent).toContain("Mapa pól jest za duża.");
    // Komunikat pola NIE dubluje się w banerze (trafił pod pole).
    expect(notice.textContent).not.toContain("To pole jest wymagane.");
  });
});
