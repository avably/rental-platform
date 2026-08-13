import type enMessages from "@/messages/en.json";

import {
  platformTermsLocalized,
  type PlatformTermsDocument,
  type PlatformTermsVersionDocument,
} from "@/lib/legal/platform-terms";

type TermsCopy = typeof enMessages.terms;

/**
 * Treść regulaminu platformy wstawiana w blok `.body-legal` szablonu —
 * lustro `PrivacyContent`, ale ŹRÓDŁEM JEST BAZA (`app.get_platform_terms`),
 * nie messages (decyzja D6 spike'u: jedno źródło dla LP, checkboxa
 * onboardingu i dowodu akceptacji).
 *
 * TREŚĆ JEST TEKSTEM I MA NIM ZOSTAĆ — zero `dangerouslySetInnerHTML`
 * (wzorzec `legal-document-view.tsx`): akapity z podziału po pustej linii,
 * pojedyncze złamania zachowuje `pre-line`. Etykieta wersji i skrót sha256
 * są CZĘŚCIĄ dokumentu, nie ozdobą — to po nich czytelnik pozna, że okazany
 * tekst jest tym, który zaakceptował przy zakładaniu organizacji.
 *
 * Sekcję i kontener wnosi WYSPA (ADR-162) — uzasadnienie w `privacy-content.tsx`.
 */
export function TermsContent({
  document,
  copy,
  locale,
}: {
  document: PlatformTermsDocument | PlatformTermsVersionDocument;
  copy: TermsCopy;
  locale: string;
}) {
  const localized = platformTermsLocalized(document, locale);
  const effective = new Date(document.effective_from);
  const effectiveText = Number.isNaN(effective.getTime())
    ? document.effective_from
    : effective.toLocaleDateString(locale === "en" ? "en-GB" : "pl-PL", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
  const paragraphs = localized.body
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const archived = "current" in document && !document.current;
  const currentHref = `/${locale}/terms`;
  const permalink = `/${locale}/terms/w/${document.version_no}`;

  return (
    <section className="section legal-body-section">
      <div className="w-layout-blockcontainer main-container w-container">
        <div className="body-legal w-richtext" data-platform-terms={document.version_label}>
          <p>
            {copy.versionLabel} {document.version_label} · {copy.effectiveLabel} {effectiveText}
          </p>
          {locale === "en" ? <p>{copy.bindingNote}</p> : null}
          {archived ? (
            <p data-platform-terms-archived>
              {copy.archivedNote} <a href={currentHref}>{copy.currentLinkLabel}</a>
            </p>
          ) : null}
          <h6>{localized.title}</h6>
          {paragraphs.map((paragraph) => (
            <p key={paragraph} style={{ whiteSpace: "pre-line" }}>
              {paragraph}
            </p>
          ))}
          <p data-platform-terms-sha>
            {/* font-sans: kontrakt typografii (gallery-contract) — każdy element
                code/pre/kbd w apkach niesie jawną klasę zamiast monospace-fallbacku
                Preflight; na osi marketingowej (arkusze szablonu, bez Tailwinda)
                klasa jest bierna wizualnie, ale kontrakt skanuje źródło statycznie. */}
            {copy.shaLabel} <code className="font-sans">{localized.sha256.slice(0, 16)}</code> ·{" "}
            {copy.permalinkLabel}{" "}
            <a href={permalink}>{permalink}</a>
          </p>
        </div>
      </div>
    </section>
  );
}
