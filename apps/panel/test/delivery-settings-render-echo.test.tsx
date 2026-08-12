import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FormState } from "@/lib/form-state";
import messages from "../messages/pl.json";

/**
 * ECHO NA ŚCIEŻCE BEZ HYDRACJI (U9) — warstwa RENDERU.
 *
 * ================== DLACZEGO PIERWSZY RENDER, A NIE KLIKANIE ==================
 *
 * Na stronie ZHYDRATOWANEJ echo niczego nie ratuje i nie miałoby czego
 * dowodzić: pola są niekontrolowane, więc po nieudanej akcji React w ogóle
 * ich nie dotyka i wpisany tekst zostaje w DOM-ie sam z siebie. Test, który
 * renderuje formularz, wpisuje wartość i klika „Zapisz", przechodzi także bez
 * echa — byłby dowodem na przypadek, który i tak już działał.
 *
 * Rzecz, która NIE działała, to pełny obieg dokumentu: formularz wysłany przed
 * hydracją, odświeżenie strony, powrót z historii. Wtedy strona renderuje się
 * OD ZERA ze stanem zwróconym przez akcję, a pola startują z `defaultValue`.
 * Dokładnie ten moment odtwarza ten plik: PIERWSZY render prawdziwego
 * komponentu przy stanie akcji już rozstrzygniętym.
 *
 * Zaślepiony jest wyłącznie `useActionState` — czyli mechanizm, którym React
 * podaje wynik akcji przy pierwszym renderze. Komponent, słownik, `Input`
 * i `PanelSelect` są prawdziwe.
 */

const actionState = { current: {} as FormState };
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    default: (actual as unknown as { default?: unknown }).default ?? actual,
    useActionState: () => [actionState.current, () => {}, false],
  };
});

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const { CredentialsForm, ParcelForm, PricingForm, SenderForm } = await import(
  "@/app/[locale]/(panel)/ustawienia-dostaw/delivery-settings-forms"
);
const { LocationsTable } = await import(
  "@/app/[locale]/(panel)/ustawienia-dostaw/punkty-odbioru/locations-table"
);

const noAction = async () => ({});
const READY = { state: "complete", savedAt: "12 sie 2026, 09:41" } as const;
const NEVER = { state: "incomplete", savedAt: null } as const;

/** Wartość, której NIE WOLNO znaleźć w źródle strony (ADR-052). */
const COURIER_PASSWORD = "tajne-haslo-kuriera-9f3b";

function render(node: React.ReactNode): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      {node}
    </NextIntlClientProvider>,
  );
}

/** Znacznik pojedynczego `<input>` po identyfikatorze — bez zgadywania. */
function inputTag(html: string, id: string): string {
  const tag = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0];
  expect(tag, `pola ${id} nie ma na ekranie`).toBeDefined();
  return tag!;
}

function valueOf(html: string, id: string): string | null {
  return inputTag(html, id).match(/ value="([^"]*)"/)?.[1] ?? null;
}

const SENDER_DEFAULTS = {
  name: "Z bazy nazwa",
  street: "Z bazy ulica",
  houseNumber: "1",
  apartmentNumber: "",
  postCode: "00-001",
  city: "Z bazy miasto",
  phone: "+48 000 000 000",
  email: "z-bazy@example.invalid",
};

const PRICING_DEFAULTS = {
  courier: { priceGrosze: 2499, freeAboveGrosze: 50000 },
  parcel_locker: { priceGrosze: 1699 },
};

beforeEach(() => {
  actionState.current = {};
});

describe("pierwszy render po nieudanym zapisie oddaje wpisane wartości", () => {
  it("BEZ echa formularz startuje z bazy (kontrola negatywna)", () => {
    const html = render(
      <PricingForm action={noAction} canWrite defaults={PRICING_DEFAULTS} status={READY} />,
    );

    expect(valueOf(html, "pricing-courierPrice")).toBe("24.99");
    expect(valueOf(html, "pricing-courierFreeAbove")).toBe("500");
  });

  it("Z echem wygrywa to, co operator wpisał — także wartość ODRZUCONA", () => {
    actionState.current = {
      fieldErrors: { courierPrice: "Nieprawidłowa kwota." },
      values: {
        courierPrice: "abc",
        courierFreeAbove: "777",
        parcelLockerPrice: "16,99",
        parcelLockerFreeAbove: "",
        ownDeliveryPrice: "1,00",
        ownDeliveryFreeAbove: "",
      },
    };

    const html = render(
      <PricingForm action={noAction} canWrite defaults={PRICING_DEFAULTS} status={READY} />,
    );

    // Wartość odrzucona przez walidację MUSI wrócić — inaczej operator nie ma
    // czego poprawić, tylko puste pole i komunikat o czymś, czego nie widzi.
    expect(valueOf(html, "pricing-courierPrice")).toBe("abc");
    expect(valueOf(html, "pricing-courierFreeAbove")).toBe("777");
    // Pole wyczyszczone świadomie zostaje puste, a nie wraca z bazy.
    expect(valueOf(html, "pricing-parcelLockerFreeAbove")).toBe("");
    // Wartość z sąsiedniego pola, której w bazie nie ma w ogóle.
    expect(valueOf(html, "pricing-ownDeliveryPrice")).toBe("1,00");
  });

  it("echo działa też w nadawcy i w paczce", () => {
    actionState.current = { values: { city: "Wpisane miasto", weightKg: "12" } };

    const sender = render(
      <SenderForm action={noAction} canWrite defaults={SENDER_DEFAULTS} status={READY} />,
    );
    expect(valueOf(sender, "sender-city")).toBe("Wpisane miasto");
    // Pole spoza echa nadal bierze wartość z bazy — echo jest częściowe
    // z natury (może przyjść z akcji, która czyta mniej pól).
    expect(valueOf(sender, "sender-street")).toBe("Z bazy ulica");

    const parcel = render(
      <ParcelForm
        action={noAction}
        canWrite
        defaults={{ lengthCm: 40, widthCm: 30, heightCm: 20, weightKg: 5 }}
        status={READY}
      />,
    );
    expect(valueOf(parcel, "parcel-weightKg")).toBe("12");
    expect(valueOf(parcel, "parcel-lengthCm")).toBe("40");
  });
});

describe("SONDA BEZPIECZEŃSTWA: hasło kuriera nie wraca do formularza", () => {
  it("wrogi stan z hasłem w echu NIE odtwarza pola hasła", () => {
    // Stan spreparowany tak, jakby warstwa akcji przepuściła hasło do echa.
    // Formularz jest DRUGĄ barierą i musi je zignorować niezależnie od tego,
    // co przyszło w stanie.
    actionState.current = {
      fieldErrors: { email: "Nieprawidłowy adres e-mail." },
      values: {
        email: "nie-jest-adresem",
        environment: "production",
        password: COURIER_PASSWORD,
      },
    };

    const html = render(
      <CredentialsForm
        action={noAction}
        configured
        canWrite
        defaults={{ email: "z-bazy@example.invalid", environment: "test" }}
        status={READY}
      />,
    );

    // Kontrola pozytywna: pole hasła JEST na ekranie, a echo naprawdę zadziałało
    // dla pozostałych pól — bez tego „nie ma hasła" byłoby prawdą o pustym zbiorze.
    const password = inputTag(html, "cred-password");
    expect(password).toContain('type="password"');
    expect(valueOf(html, "cred-email")).toBe("nie-jest-adresem");

    expect(valueOf(html, "cred-password"), "hasło odtworzone z echa").toBe(null);
    expect(html, "hasło kuriera w źródle strony").not.toContain(COURIER_PASSWORD);
  });
});

describe("błędy stoją PRZY POLACH, a nie jedną linijką w stopce", () => {
  it("każde wadliwe pole nadawcy niesie swój komunikat, aria-invalid i opis", () => {
    actionState.current = {
      fieldErrors: { postCode: "Podaj kod pocztowy.", phone: "Podaj telefon." },
      values: { ...SENDER_DEFAULTS, postCode: "", phone: "" },
    };

    const html = render(
      <SenderForm action={noAction} canWrite defaults={SENDER_DEFAULTS} status={READY} />,
    );

    for (const [field, message] of [
      ["postCode", "Podaj kod pocztowy."],
      ["phone", "Podaj telefon."],
    ] as const) {
      const tag = inputTag(html, `sender-${field}`);
      expect(tag, `${field} bez aria-invalid`).toContain('aria-invalid="true"');
      expect(tag, `${field} bez powiązania z komunikatem`).toContain(
        `aria-describedby="sender-${field}-error"`,
      );
      expect(html).toContain(`id="sender-${field}-error"`);
      expect(html).toContain(message);
    }

    // Pole bez błędu nie dostaje ani znacznika, ani opisu.
    expect(inputTag(html, "sender-city")).not.toContain('aria-invalid="true"');
    // Stopka nie powtarza treści błędu — kieruje do pól i uspokaja o danych.
    expect(html).toContain(messages.orders.delivery.settings.fixFieldsHint);
  });
});

describe("stan sekcji i wymagalność pól są widoczne bez klikania", () => {
  it("każda karta niesie chip osi delivery-section i datę ostatniego zapisu", () => {
    const html = render(
      <SenderForm action={noAction} canWrite defaults={SENDER_DEFAULTS} status={READY} />,
    );
    expect(html).toContain('data-secondary-status-axis="delivery-section"');
    expect(html).toContain('data-secondary-status-value="complete"');
    expect(html).toContain("12 sie 2026, 09:41");
  });

  it("sekcja nigdy niezapisana mówi to wprost, zamiast udawać gotowość", () => {
    const html = render(<SenderForm action={noAction} canWrite defaults={null} status={NEVER} />);
    expect(html).toContain('data-secondary-status-value="incomplete"');
    expect(html).toContain(messages.orders.delivery.settings.neverSaved);
    expect(html).not.toContain(messages.orders.delivery.settings.savedAt.replace(" {when}", ""));
  });

  it("pole opcjonalne jest oznaczone, wymagane niesie `required`", () => {
    const html = render(
      <SenderForm action={noAction} canWrite defaults={SENDER_DEFAULTS} status={READY} />,
    );
    expect(inputTag(html, "sender-name")).toContain("required");
    expect(inputTag(html, "sender-apartmentNumber")).not.toContain("required");
    expect(html).toContain(messages.orders.delivery.settings.optionalMark);
    expect(html).toContain(messages.orders.delivery.settings.requiredHint);
  });
});

describe("chip „zapisano” zapala się WYŁĄCZNIE od sukcesu akcji", () => {
  it("odmowa uprawnień nie daje potwierdzenia zapisu", () => {
    actionState.current = {
      formError: "Ustawienia dostaw może zmieniać wyłącznie właściciel konta.",
      values: SENDER_DEFAULTS,
    };
    const html = render(
      <SenderForm action={noAction} canWrite defaults={SENDER_DEFAULTS} status={READY} />,
    );
    expect(html).toContain("wyłącznie właściciel konta");
    expect(html, "odmowa pokazana jako zapis").not.toContain(
      messages.orders.delivery.settings.savedOk,
    );
  });

  it("sukces daje potwierdzenie (kontrola pozytywna)", () => {
    actionState.current = { success: "courier_sender" };
    const html = render(
      <SenderForm action={noAction} canWrite defaults={SENDER_DEFAULTS} status={READY} />,
    );
    expect(html).toContain(messages.orders.delivery.settings.savedOk);
  });
});

describe("skutek wyłączenia punktu odbioru stoi PRZY przycisku", () => {
  const noop = async () => ({});
  const rows = [
    { id: "a", name: "Magazyn", address: "ul. Przykładowa 1", active: true, toggleAction: noop },
    { id: "b", name: "Filia", address: "ul. Druga 2", active: false, toggleAction: noop },
  ];

  it("zdanie o skutku jest na TYM ekranie i wskazuje je każdy przycisk", () => {
    const html = render(<LocationsTable rows={rows} />);

    // Kontrola pozytywna: przyciski w ogóle się wyrenderowały.
    expect(html).toContain(messages.orders.delivery.locations.deactivate);
    expect(html).toContain(messages.orders.delivery.locations.activate);

    // Do U9 to zdanie stało na ekranie RODZICA, gdzie nie ma żadnego przycisku.
    expect(html).toContain(messages.orders.delivery.locations.toggleEffect);
    expect(html).toContain('id="location-toggle-effect"');

    const buttons = [...html.matchAll(/<button[^>]*type="submit"[^>]*>/g)].map(([tag]) => tag);
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button, "przycisk bez powiązania ze skutkiem").toContain(
        'aria-describedby="location-toggle-effect"',
      );
    }
  });

  it("czasownik nazywa przejście między stanami kolumny „Status”", () => {
    // „Wygaś”/„Przywróć” wprowadzało trzeci słownik obok „Aktywny/Nieaktywny”.
    expect(messages.orders.delivery.locations.deactivate).toBe("Wyłącz");
    expect(messages.orders.delivery.locations.activate).toBe("Włącz");
    // Skutek zszedł z karty na ekranie rodzica — tam zostaje samo „po co”.
    expect(messages.orders.delivery.locations.cardDescription).not.toContain("wystawionych");
  });
});

describe("reguła ról stoi przy stopce zapisu, nie osobną kartą na górze", () => {
  it("członek zespołu widzi zdanie tam, gdzie brakuje przycisku", () => {
    const html = render(
      <SenderForm action={noAction} canWrite={false} defaults={SENDER_DEFAULTS} status={READY} />,
    );
    expect(html).toContain('data-delivery-access-rule="member-reads"');
    expect(html).toContain(messages.orders.delivery.settings.accessRuleMember);
    expect(html).not.toContain('type="submit"');
  });

  it("właściciel dostaje przycisk zamiast zdania o braku uprawnień", () => {
    const html = render(
      <SenderForm action={noAction} canWrite defaults={SENDER_DEFAULTS} status={READY} />,
    );
    expect(html).toContain('type="submit"');
    expect(html).not.toContain(messages.orders.delivery.settings.accessRuleMember);
  });
});
