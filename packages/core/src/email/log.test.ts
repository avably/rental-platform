/**
 * `sendAndLog` — wspólny krok „wyślij i zapisz" (ADR-045) i JEDYNE miejsce,
 * które składa treść wpisu historii (0035, ADR-073).
 *
 * Ten plik broni własności, na której stoi cały podgląd treści: wpis niesie
 * TEN SAM napis, który dostał transport. Nie „równy", tylko TEN SAM — bo
 * jedynym sposobem, żeby napisy były równe przypadkiem, jest policzenie
 * treści drugi raz, a druga kopia szablonu potrafi rozminąć się z tym, co
 * zobaczył klient (inne dane tenanta, inny cennik, inna wersja szablonu).
 *
 * Reguła „log nie wywraca operacji" jest tu sprawdzana razem z treścią:
 * dołożenie ciężkiego pola do wpisu nie może zmienić tego, że awaria
 * rejestru wraca powodem, a nie wyjątkiem.
 */
import { describe, expect, it } from "vitest";

import { sendAndLog } from "./log";
import type { EmailLogEntry } from "./log";
import type { EmailTransport, OutgoingEmail } from "./types";

const email: OutgoingEmail = {
  from: "Wypożyczalnia Demo <noreply@avably.io>",
  to: "klient@example.com",
  subject: "Potwierdzenie rezerwacji",
  html: "<html><body><p>Rezerwacja AV-2026-001 potwierdzona.</p></body></html>",
  text: "Rezerwacja AV-2026-001 potwierdzona.",
};

function capture(): { entries: EmailLogEntry[]; recorder: { record(e: EmailLogEntry): Promise<void> } } {
  const entries: EmailLogEntry[] = [];
  return { entries, recorder: { record: async (entry) => void entries.push(entry) } };
}

const ok: EmailTransport = { send: async () => ({ id: "resend-1" }) };
const broken: EmailTransport = {
  send: async () => {
    throw new Error("HTTP 422 domain not verified");
  },
};

describe("sendAndLog — treść wpisu historii", () => {
  it("zapisuje DOKŁADNIE ten napis HTML, który poszedł do transportu", async () => {
    const { entries, recorder } = capture();

    await sendAndLog({ transport: ok, recorder, email, kind: "rental_confirmed" });

    expect(entries).toHaveLength(1);
    // Tożsamość referencji, nie równość treści — patrz nagłówek.
    expect(entries[0]!.body).toBe(email.html);
  });

  it("porażka wysyłki NIE gubi treści (wpis 'failed' niesie to, co miało pójść)", async () => {
    const { entries, recorder } = capture();

    const result = await sendAndLog({ transport: broken, recorder, email, kind: "rental_confirmed" });

    expect(result.sendError).toBeInstanceOf(Error);
    expect(entries[0]).toMatchObject({ status: "failed" });
    expect(entries[0]!.body).toBe(email.html);
  });

  it("do rejestru idzie wariant HTML, nie tekstowy", async () => {
    const { entries, recorder } = capture();

    await sendAndLog({ transport: ok, recorder, email, kind: "rental_confirmed" });

    // `text` jest zapasem dla czytników bez HTML-a i NIE odpowiada na pytanie
    // „co klient zobaczył" — podgląd pokazujący go zamiast HTML-a pokazywałby
    // inną wiadomość niż ta, którą otwarto w skrzynce.
    expect(entries[0]!.body).not.toBe(email.text);
    expect(entries[0]!.body).toContain("<html>");
  });

  it("awaria rejestru z treścią w tle nadal NIE wywraca wysyłki", async () => {
    const result = await sendAndLog({
      transport: ok,
      recorder: {
        record: async () => {
          throw new Error("brak połączenia z bazą");
        },
      },
      email,
      kind: "rental_confirmed",
    });

    expect(result.sendError).toBeUndefined();
    expect(result.logIssue).toContain("brak połączenia z bazą");
  });
});
