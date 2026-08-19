import { PRODUCT_NAME, bcp47, type Locale } from "@avably/core";
import type { ReactNode } from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "react-email";

import { emailMessages } from "../messages";
import { EMAIL_STYLES } from "../styles";

/**
 * ZNAK NAJEMCY W WIADOMOŚCI (ADR-175) — gotowy adres i gotowy tekst zastępczy.
 *
 * Kontrakt 8a bez wyjątku: pakiet nie zna ani bucketa, ani najemcy, ani tego,
 * skąd wołający wziął ścieżkę. Dostaje ADRES PUBLICZNY — bo klient poczty
 * pobiera obrazek sam, godziny po wysyłce, spoza naszej sesji, i żaden adres
 * podpisany ani wewnętrzny nie miałby jak zadziałać.
 *
 * `undefined` znaczy „najemca nie ma znaku" i jest stanem NORMALNYM: ramka
 * pokazuje wtedy jego NAZWĘ tekstem, dokładnie jak przed tą zmianą.
 */
export interface EmailTenantLogo {
  src: string;
  /** Nigdy pusty — wołający liczy go `siteLogoAlt` (ADR-160, decyzja 7). */
  alt: string;
}

/**
 * ZNAK AVABLY W MAILACH PLATFORMOWYCH (ADR-210) - raster z kanonicznego
 * znaku (apps/panel/components/shell/brand-mark.tsx, wariant full-lime),
 * hostowany publicznie przez storefront. Adres ABSOLUTNY, bo klient poczty
 * pobiera obraz sam, godziny po wysylce, spoza naszej sesji. Kapsula
 * limonkowa ma tlo wpieczone w plik, wiec jeden asset czyta sie na jasnym
 * motywie i przy inwersji dark-mode. Wymiary sa JAWNE (klienci poczty bez
 * nich rozjezdzaja uklad): wyswietlanie 150x40 px, zrodlo 300x80 (retina 2x).
 * Przy zablokowanych obrazach `alt={PRODUCT_NAME}` pokazuje tekst "Avably" -
 * stan sprzed tej zmiany. Dotyczy WYLACZNIE maili platformowych: koresponden-
 * cja najemcy z klientem (RentalEmailLayout ponizej) nosi marke najemcy.
 */
const PLATFORM_BRAND_LOGO = {
  src: "https://www.avably.io/marketing/avably-logo-email.png",
  width: 150,
  height: 40,
} as const;

export interface EmailLayoutProps {
  children: ReactNode;
  cta: {
    href: string;
    label: string;
  };
  heading: string;
  /** Język odbiorcy — steruje treścią ramki i atrybutem `lang`. */
  locale: Locale;
  previewText: string;
}

export interface RentalEmailLayoutProps {
  children: ReactNode;
  footerText: string;
  heading: string;
  /** Język odbiorcy — steruje atrybutem `lang`. */
  locale: Locale;
  previewText: string;
  /** Nazwa wypożyczalni z danych tenanta. */
  tenantName: string;
  /**
   * Znak najemcy, KTÓREGO DOTYCZY wiadomość (ADR-175). Brak = nazwa tekstem.
   * Prop jest opcjonalny, bo trzecim stanem jest właśnie jego nieobecność —
   * a nie dlatego, że wolno o niego nie zadbać.
   */
  logo?: EmailTenantLogo;
}

export function EmailLayout({
  children,
  cta,
  heading,
  locale,
  previewText,
}: EmailLayoutProps) {
  const t = emailMessages(locale).layout;
  const lang = bcp47(locale);

  return (
    <Html lang={lang}>
      <Head />
      <Preview>{previewText}</Preview>
      <Body lang={lang} style={EMAIL_STYLES.body}>
        <Container style={EMAIL_STYLES.container}>
          <Section style={EMAIL_STYLES.card}>
            <Img
              alt={PRODUCT_NAME}
              height={PLATFORM_BRAND_LOGO.height}
              src={PLATFORM_BRAND_LOGO.src}
              style={EMAIL_STYLES.brandLogo}
              width={PLATFORM_BRAND_LOGO.width}
            />
            <Heading as="h1" style={EMAIL_STYLES.heading}>
              {heading}
            </Heading>
            {children}
            <Section style={EMAIL_STYLES.ctaSection}>
              <Button href={cta.href} style={EMAIL_STYLES.button}>
                {cta.label}
              </Button>
            </Section>
            <Text style={EMAIL_STYLES.fallbackText}>
              {t.fallbackHint}
              <br />
              <Link href={cta.href} style={EMAIL_STYLES.fallbackLink}>
                {cta.href}
              </Link>
            </Text>
            <Hr style={EMAIL_STYLES.divider} />
            <Text style={EMAIL_STYLES.footer}>
              {PRODUCT_NAME} · {t.footerTagline}
              <br />
              {t.footerAutomated}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

/**
 * Wariant dla korespondencji wypożyczalni z klientem. Nie pokazuje marki
 * platformy ani CTA, którego nie ma w kontrakcie cyklu najmu.
 */
export function RentalEmailLayout({
  children,
  footerText,
  heading,
  locale,
  logo,
  previewText,
  tenantName,
}: RentalEmailLayoutProps) {
  const lang = bcp47(locale);

  return (
    <Html lang={lang}>
      <Head />
      <Preview>{previewText}</Preview>
      <Body lang={lang} style={EMAIL_STYLES.body}>
        <Container style={EMAIL_STYLES.container}>
          <Section style={EMAIL_STYLES.card}>
            {/*
              Znak ZASTĘPUJE napis z nazwą — ta sama reguła, co w nagłówku
              sklepu (ADR-160, decyzja 7): dwie reprezentacje tej samej firmy
              obok siebie czytają się jak dwie firmy. Nazwa nie znika
              z wiadomości: stoi w stopce ramki, jak stała.
            */}
            {logo ? (
              <Img alt={logo.alt} src={logo.src} style={EMAIL_STYLES.logo} />
            ) : (
              <Text style={EMAIL_STYLES.brand}>{tenantName}</Text>
            )}
            <Heading as="h1" style={EMAIL_STYLES.heading}>
              {heading}
            </Heading>
            {children}
            <Hr style={EMAIL_STYLES.divider} />
            <Text style={EMAIL_STYLES.footer}>
              {tenantName}
              <br />
              {footerText}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
