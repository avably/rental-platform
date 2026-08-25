// @vitest-environment jsdom

/**
 * KONTENER ANTYBOTOWY NIE REZERWUJE MIEJSCA NA ZAPAS (S-33, audyt UX
 * 2026-08-25).
 *
 * Widget w trybie niewidzialnym / interaction-only wstawia ramkę schowaną
 * INLINE'OWYM stylem dostawcy — jej pudełko rezerwowało ~72 px między polem
 * wiadomości a przyciskiem formularza kontaktu. Kontrakt: kontener jest
 * `hidden`, dopóki w środku nie stoi ramka BEZ inline'owego ukrycia, i odsłania
 * się w chwili, w której dostawca faktycznie coś pokazuje (interaction-only
 * pokazuje wyzwanie dopiero, gdy musi — obserwator mutacji łapie tę zmianę).
 *
 * Skrypt dostawcy nie ładuje się w jsdom, więc ramki wstawiamy tu ręcznie —
 * dokładnie tak, jak robi to api.js: do kontenera `data-turnstile-container`.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TurnstileWidget } from "@/components/turnstile-widget";

afterEach(cleanup);

function container(root: HTMLElement): HTMLElement {
  return root.querySelector<HTMLElement>("[data-turnstile-container]")!;
}

describe("kontener widgetu antybotowego (S-33)", () => {
  it("startuje SCHOWANY — zanim dostawca cokolwiek wstawi, nie ma czego rezerwować", () => {
    const { container: root } = render(
      <TurnstileWidget siteKey="test" locale="pl" onToken={() => {}} />,
    );
    expect(container(root).hidden).toBe(true);
  });

  it("ramka WIDOCZNA odsłania kontener", async () => {
    const { container: root } = render(
      <TurnstileWidget siteKey="test" locale="pl" onToken={() => {}} />,
    );
    const slot = container(root);
    const frame = document.createElement("iframe");
    slot.appendChild(frame);
    await waitFor(() => expect(slot.hidden).toBe(false));
  });

  it("ramka schowana przez dostawcę (display:none / visibility:hidden / rozmiar 0) NIE odsłania", async () => {
    const { container: root } = render(
      <TurnstileWidget siteKey="test" locale="pl" onToken={() => {}} />,
    );
    const slot = container(root);

    const hiddenFrame = document.createElement("iframe");
    hiddenFrame.style.display = "none";
    slot.appendChild(hiddenFrame);

    const invisibleWrap = document.createElement("div");
    invisibleWrap.style.visibility = "hidden";
    invisibleWrap.appendChild(document.createElement("iframe"));
    slot.appendChild(invisibleWrap);

    const zeroFrame = document.createElement("iframe");
    zeroFrame.setAttribute("width", "0");
    slot.appendChild(zeroFrame);

    // Mutacje przetworzone — mikrozadanie obserwatora zdążyło odpalić.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(slot.hidden).toBe(true);
  });

  it("interaction-only: ODSŁONIĘCIE ramki przez dostawcę odsłania kontener w locie", async () => {
    const { container: root } = render(
      <TurnstileWidget siteKey="test" locale="pl" onToken={() => {}} />,
    );
    const slot = container(root);
    const frame = document.createElement("iframe");
    frame.style.visibility = "hidden";
    slot.appendChild(frame);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(slot.hidden).toBe(true);

    // Dostawca pokazuje wyzwanie: zdejmuje inline'owe ukrycie.
    frame.style.visibility = "";
    await waitFor(() => expect(slot.hidden).toBe(false));
  });
});
