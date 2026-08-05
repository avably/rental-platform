import {
  contactMapHref,
  contactTelHref,
  type ContactEntryKind,
  type ContactStructuredContent,
  type ContactStructuredItem,
} from "@avably/core/site";
import type { ReactNode } from "react";

import { externalLinkRel } from "../links";
import type { SiteRenderLabels } from "../types";

/**
 * DANE KONTAKTOWE SEKCJI v3 (E4, ADR-095) — część wspólna obu układów.
 *
 * ==================== KLIKALNOŚĆ JEST FUNKCJĄ RODZAJU ====================
 *
 * Wpis niesie RODZAJ (`kind`), a nie sam napis, więc render nie zgaduje:
 * adres e-mail zawsze staje się `mailto:`, numer zawsze `tel:`, zapytanie mapy
 * zawsze odnośnikiem do wyszukiwarki map, a adres i godziny zostają tekstem.
 * Wersja zgadująca po kształcie („czy to wygląda na numer") gubiłaby numery
 * zapisane nietypowo — i to bez żadnego komunikatu, bo brak odnośnika nie jest
 * błędem, tylko brakiem.
 *
 * Etykiety rodzajów idą z JĘZYKA STRONY (`SiteRenderLabels`), nie z treści:
 * to są nazwy pojęć, a nie tekst najemcy, więc sklep po angielsku nie może
 * pokazać przy numerze polskiego „Telefon:".
 *
 * ZERO HEKSÓW — kolor wyłącznie przez klasy ról (`site-*`), zestawiane ze
 * źródłami przez `structured-role-usage.test.tsx`.
 */

/** Etykieta rodzaju wpisu — jedno miejsce, w którym rodzaj spotyka się z językiem. */
function labelOf(kind: ContactEntryKind, labels: SiteRenderLabels): string {
  switch (kind) {
    case "email":
      return labels.contactEmail;
    case "phone":
      return labels.contactPhone;
    case "address":
      return labels.contactAddress;
    case "hours":
      return labels.contactHours;
    case "map":
      return labels.contactMap;
  }
}

/**
 * Wartość wpisu w postaci, w jakiej stoi na stronie. `map` jest jedynym
 * rodzajem prowadzącym POZA stronę, więc jako jedyny liczy `rel` wspólną
 * regułą linków wychodzących — adres składamy my, ale otwiera się on w obcym
 * serwisie i uchwyt do karty klienta ma tam nie dojechać.
 */
function valueOf(item: ContactStructuredItem): ReactNode {
  switch (item.kind) {
    case "email":
      return (
        <a data-contact-value="email" className="site-link" href={`mailto:${item.value}`}>
          {item.value}
        </a>
      );
    case "phone":
      return (
        <a data-contact-value="phone" className="site-link" href={contactTelHref(item.value)}>
          {item.value}
        </a>
      );
    case "map": {
      const href = contactMapHref(item.value);
      return (
        <a
          data-contact-value="map"
          className="site-link"
          href={href}
          rel={externalLinkRel(href)}
        >
          {item.value}
        </a>
      );
    }
    case "address":
    case "hours":
      // `whitespace-pre-line`: adres bywa wpisany w dwóch wierszach i tak ma
      // zostać. Zwijanie go do jednej linii jest zmianą treści najemcy.
      return (
        <span data-contact-value={item.kind} className="whitespace-pre-line">
          {item.value}
        </span>
      );
  }
}

export function ContactDetails({
  content,
  labels,
}: {
  content: ContactStructuredContent;
  labels: SiteRenderLabels;
}) {
  return (
    /*
     * Lista opisowa, bo to są PARY „pojęcie → wartość", a nie akapity: czytnik
     * ekranu zapowiada wtedy „Telefon: +48…" jako jedną informację. Ta sama
     * struktura, którą sekcja kontaktu miała w v1 — zmieniło się źródło danych,
     * nie sposób ich czytania.
     */
    <dl data-contact-details className="m-0 flex flex-col gap-3 text-base">
      {content.items.map((item, index) => (
        <div key={`${item.kind}-${index}`} data-contact-entry={item.kind} className="flex flex-wrap gap-2">
          <dt className="site-label">{labelOf(item.kind, labels)}</dt>
          <dd className="m-0">{valueOf(item)}</dd>
        </div>
      ))}
    </dl>
  );
}
