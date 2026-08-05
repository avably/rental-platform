import { contactFormVisible, type ContactStructuredContent } from "@avably/core/site";

import type { TemplateStyles } from "../template";
import type { ContactFormBinding, SiteRenderLabels } from "../types";
import { ContactDetails } from "./contact-details";
import { StructuredContactForm } from "./contact-form";
import { StructuredSectionShell } from "./shell";

/**
 * KONTAKT — UKŁAD „OBOK SIEBIE" (E4, ADR-095).
 *
 * Dane po lewej, formularz po prawej: oba widoczne bez przewijania, więc
 * odwiedzający nie musi wybierać drogi „w ciemno". Ten sam `items` i ta sama
 * para przełączników co w kolumnie — różnica jest WYŁĄCZNIE w kontenerze.
 *
 * DRUGA KOLUMNA DOPIERO OD 48 rem SZEROKOŚCI SEKCJI (zapytanie kontenerowe
 * `@min-[48rem]/site`, ADR-085), a nie od szerokości okna: na płótnie kreatora
 * zwężonym do 390 px sekcja ma zachowywać się jak na telefonie, bo po to
 * płótno jest podglądem. Poniżej progu układ schodzi do kolumny, czyli do
 * dokładnie tego, co robi wariant `stacked` — i to jest w porządku: wariant
 * wybiera się dla ekranu, na którym jest miejsce.
 *
 * Sekcja bez formularza (brak adresata albo wyłączony przełącznik) zostaje
 * z jedną kolumną — siatka nie rysuje pustego miejsca po nieistniejącym
 * dziecku, więc dane nie uciekają na połowę szerokości.
 */
export function StructuredContactSplit({
  content,
  styles,
  labels,
  sectionId,
  contactForm,
}: {
  content: ContactStructuredContent;
  styles: TemplateStyles;
  labels: SiteRenderLabels;
  sectionId?: string;
  contactForm?: ContactFormBinding;
}) {
  const withForm = contactFormVisible(content);
  return (
    <StructuredSectionShell
      type="contact"
      layout="split"
      background={content.background}
      heading={content.heading}
      styles={styles}
    >
      <div
        className={`mt-8 grid gap-10${withForm ? " @min-[48rem]/site:grid-cols-2" : ""}`}
      >
        <ContactDetails content={content} labels={labels} />
        {withForm ? (
          <StructuredContactForm
            content={content}
            sectionId={sectionId ?? ""}
            labels={labels}
            binding={contactForm}
          />
        ) : null}
      </div>
    </StructuredSectionShell>
  );
}
