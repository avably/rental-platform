import { contactFormVisible, type ContactStructuredContent } from "@avably/core/site";

import type { TemplateStyles } from "../template";
import type { ContactFormBinding, SiteRenderLabels } from "../types";
import { ContactDetails } from "./contact-details";
import { StructuredContactForm } from "./contact-form";
import { StructuredSectionShell } from "./shell";

/**
 * KONTAKT — UKŁAD „KOLUMNA" (E4, ADR-095).
 *
 * Dane kontaktowe, a pod nimi formularz. Kto przyszedł zadzwonić, dzwoni
 * z pierwszego ekranu i nie schodzi niżej; kto chce napisać, przewija.
 * To jest układ domyślny, bo działa tak samo na telefonie i na monitorze —
 * druga kolumna ma sens dopiero od pewnej szerokości (patrz `split`).
 *
 * FORMULARZ POJAWIA SIĘ POD DWOMA WARUNKAMI (`contactFormVisible`):
 * przełącznik operatora i istnienie adresata. Sekcja bez adresu e-mail
 * renderuje się jako same dane kontaktowe — to jest STAN, nie awaria, więc nie
 * ma tu żadnego komunikatu dla odwiedzającego (jego to nie dotyczy).
 */
export function StructuredContactStacked({
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
  return (
    <StructuredSectionShell
      type="contact"
      layout="stacked"
      background={content.background}
      heading={content.heading}
      styles={styles}
    >
      <div className="mt-8 flex flex-col gap-10">
        <ContactDetails content={content} labels={labels} />
        {contactFormVisible(content) ? (
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
