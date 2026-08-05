/**
 * BILET FORMULARZA KONTAKTU (E4, ADR-095).
 *
 * Warstwa „minimalnego czasu od renderu" jest warta tyle, ile jej PODPIS.
 * Testy niżej pilnują dokładnie tej różnicy: bilet ma nie dać się podrobić ani
 * przepisać, a jego wiek ma być liczony od chwili WYSTAWIENIA, nie od niczego.
 *
 * Czas wstrzykujemy (`now`), bo test zależny od zegara systemowego albo
 * potrzebuje uśpienia (i trwa sekundy), albo jest niedeterministyczny.
 */
import { describe, expect, it } from "vitest";

import {
  CONTACT_TICKET_MAX_SECONDS,
  CONTACT_TICKET_MIN_SECONDS,
  issueContactTicket,
  verifyContactTicket,
} from "@/lib/contact/ticket";

const SEKRET = "sekret-testowy-formularza";
const T0 = 1_754_300_000_000; // stała chwila — patrz nagłówek
const sekundy = (n: number) => T0 + n * 1000;

describe("z sekretem: fail-closed", () => {
  it("świeżo wystawiony bilet jest ZA SZYBKI — człowiek nie czyta w zero sekund", () => {
    const ticket = issueContactTicket({ now: T0, secret: SEKRET });
    expect(verifyContactTicket(ticket, { now: T0, secret: SEKRET })).toBe("too_fast");
  });

  it("po minimalnym czasie bilet jest ważny", () => {
    const ticket = issueContactTicket({ now: T0, secret: SEKRET });
    expect(
      verifyContactTicket(ticket, { now: sekundy(CONTACT_TICKET_MIN_SECONDS), secret: SEKRET }),
    ).toBe("ok");
  });

  it("po terminie ważności odpada", () => {
    const ticket = issueContactTicket({ now: T0, secret: SEKRET });
    expect(
      verifyContactTicket(ticket, { now: sekundy(CONTACT_TICKET_MAX_SECONDS + 1), secret: SEKRET }),
    ).toBe("too_old");
  });

  it("PODROBIONY czas nie przechodzi — o to chodzi w podpisie", () => {
    const ticket = issueContactTicket({ now: T0, secret: SEKRET });
    const [, podpis] = ticket.split(".");
    // Bot przepisuje czas na starszy, żeby ominąć minimalny odstęp, i zostawia
    // podpis, którego nie umie policzyć.
    const podmieniony = `${Math.floor(T0 / 1000) - 600}.${podpis}`;
    expect(verifyContactTicket(podmieniony, { now: sekundy(1), secret: SEKRET })).toBe("invalid");
  });

  it("bilet podpisany INNYM sekretem nie przechodzi", () => {
    const obcy = issueContactTicket({ now: T0, secret: "sekret-napastnika" });
    expect(verifyContactTicket(obcy, { now: sekundy(10), secret: SEKRET })).toBe("invalid");
  });

  it.each(["", "bezkropki", "abc.def", ".", `${Math.floor(T0 / 1000)}.`])(
    "śmieć w miejscu biletu (%s) jest odmową, nie wyjątkiem",
    (ticket) => {
      expect(verifyContactTicket(ticket, { now: sekundy(10), secret: SEKRET })).toBe("invalid");
    },
  );

  it("bilet z PRZYSZŁOŚCI liczy się jak zbyt świeży", () => {
    const ticket = issueContactTicket({ now: sekundy(600), secret: SEKRET });
    expect(verifyContactTicket(ticket, { now: T0, secret: SEKRET })).toBe("too_fast");
  });
});

describe("bez sekretu: warstwa JAWNIE wyłączona", () => {
  it("weryfikacja przepuszcza (dev/CI bez sekretów mają działający formularz)", () => {
    expect(verifyContactTicket("cokolwiek", { now: T0, secret: undefined })).toBe("ok");
    expect(verifyContactTicket("", { now: T0, secret: undefined })).toBe("ok");
  });

  it("wystawiony bilet nie udaje podpisanego", () => {
    const ticket = issueContactTicket({ now: T0, secret: undefined });
    expect(ticket).not.toContain(".");
  });
});
