/**
 * Widok dokumentu prawnego sklepu (B4, ADR-129) — wspólny dla żywej wersji
 * (/regulamin, /prywatnosc) i dla permalinku wersji archiwalnej
 * (/regulamin/w/2).
 *
 * TREŚĆ JEST TEKSTEM I MA NIM ZOSTAĆ. Ani jednego `dangerouslySetInnerHTML`:
 * `body` pisze najemca w panelu, więc wstrzyknięcie HTML byłoby wstrzyknięciem
 * skryptu na jego własną domenę — z sesją klienta i formularzem checkoutu obok.
 * Akapity powstają z podziału po pustej linii, a pojedyncze złamania zachowuje
 * `whitespace-pre-line`, więc autor dostaje układ, który napisał, bez ani
 * jednego znacznika.
 *
 * WERSJA I SUMA KONTROLNA SĄ CZĘŚCIĄ DOKUMENTU, NIE OZDOBĄ: to jedyne, po czym
 * klient pozna, że okazywany tekst jest tym samym, na który przystał.
 */
import type { StorefrontCopy } from "@/lib/storefront/copy";
import { format } from "@/lib/storefront/copy";
import { SITE_HEADING } from "@/components/storefront/store-chrome";

export interface LegalDocumentViewProps {
  title: string;
  body: string;
  versionLabel: string;
  publishedAt: string;
  sha256: string;
  locale: string;
  copy: StorefrontCopy;
  /** Adres wersji ŻYWEJ — podawany tylko wtedy, gdy oglądana jest archiwalna. */
  currentHref?: string;
}

/** Akapity z pustych linii; puste ciągi znikają, żeby nie robić dziur. */
function paragraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function LegalDocumentView({
  title,
  body,
  versionLabel,
  publishedAt,
  sha256,
  locale,
  copy,
  currentHref,
}: LegalDocumentViewProps) {
  const published = new Date(publishedAt);
  const publishedText = Number.isNaN(published.getTime())
    ? publishedAt
    : published.toLocaleDateString(locale === "en" ? "en-GB" : "pl-PL", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });

  return (
    <article data-legal-document="true" data-legal-version={versionLabel}>
      <h1 className={`text-2xl tracking-tight ${SITE_HEADING}`}>{title}</h1>

      <p className="mt-2 text-sm opacity-70" data-legal-meta="true">
        {format(copy.legal.version, { version: versionLabel })} ·{" "}
        {format(copy.legal.publishedAt, { date: publishedText })}
      </p>

      {currentHref ? (
        <p
          className="site-rule-top mt-4 pt-4 text-sm"
          role="note"
          data-legal-archived="true"
        >
          {copy.legal.archivedNotice}{" "}
          <a className="underline underline-offset-4" href={currentHref}>
            {copy.legal.currentVersionLink}
          </a>
        </p>
      ) : null}

      <div className="mt-6 flex flex-col gap-4 text-sm leading-7">
        {paragraphs(body).map((paragraph, index) => (
          // Kolejność akapitów jest stała w obrębie renderu niezmiennej wersji
          // — indeks jest tu poprawnym kluczem, bo lista nie ma jak się zmienić.
          <p key={index} className="whitespace-pre-line">
            {paragraph}
          </p>
        ))}
      </div>

      <p className="site-rule-top mt-8 pt-4 font-mono text-xs opacity-60">
        {copy.legal.checksum}: {sha256.slice(0, 16)}
      </p>
    </article>
  );
}
