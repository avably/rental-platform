"use client";

import type { FaqStructuredContent } from "@avably/core/site";
import { useId, useState } from "react";

import { cn } from "../../lib/cn";
import { bindOrphans } from "../orphans";
import { SafeRichText } from "../rich-text";
import type { TemplateStyles } from "../template";
import { StructuredSectionShell } from "./shell";

/**
 * FAQ — UKŁAD „ACCORDION” WEDŁUG W3C APG (E1, ADR-094).
 *
 * ==================== DLACZEGO NIE `<details>` ====================
 *
 * Sekcja v1 stała na `<details>/<summary>` z jednego dobrego powodu: render
 * zostawał serwerowy, bez ani jednego skryptu pod CSP z nonce. Kosztem było to,
 * czego `<details>` nie umie, a czego wzorzec APG wymaga i czego oczekuje
 * operator: jednej otwartej odpowiedzi naraz (albo wielu — na ustawienie),
 * stanu, który da się przełączyć z zewnątrz, i nagłówka, który jest NAGŁÓWKIEM
 * w drzewie dostępności, a nie `<summary>` o roli przycisku sklejonej z treścią.
 *
 * Dlatego ten układ jest komponentem klienckim — to JEDYNY skrypt, który sekcja
 * FAQ wnosi na stronę najemcy. CSP storefrontu tego nie blokuje: `strict-dynamic`
 * z nonce obejmuje skrypty Next.js, więc hydratacja idzie tą samą drogą, co
 * koszyk i kasa.
 *
 * ==================== CO SKŁADA SIĘ NA APG ====================
 *
 *   • tytuł pary siedzi w ELEMENCIE NAGŁÓWKOWYM (`<h3 aria-level={3}>`),
 *     a przycisk jest JEGO dzieckiem — nie odwrotnie. Odwrotność (nagłówek
 *     w przycisku) daje czytnikowi „przycisk zawierający nagłówek”, czyli
 *     nawigację po nagłówkach bez pytań FAQ;
 *   • `aria-expanded` mówi stan, `aria-controls` wskazuje panel — jedno bez
 *     drugiego zostawia czytnika ze stanem, do którego nie umie przeskoczyć;
 *   • klawiatura idzie Z DEFINICJI: przełącznikiem jest natywny `<button>`,
 *     więc Enter i Spacja działają, focus jest widoczny, a wszystkie przyciski
 *     stoją w naturalnej sekwencji Tab (żadnego `tabindex`).
 *
 * PIERWSZA PARA JEST OTWARTA na wejściu: sekcja FAQ złożona z samych
 * zamkniętych belek wygląda jak lista linków i nie pokazuje, czym jest.
 */
export function StructuredFaqAccordion({
  content,
  styles,
}: {
  content: FaqStructuredContent;
  styles: TemplateStyles;
}) {
  const id = useId();
  // Pierwsza para otwarta — patrz docblock. Zbiór, a nie pojedynczy indeks:
  // przy „pozwól otworzyć wiele naraz” stan jest z definicji mnogi, a jeden
  // kształt stanu dla obu trybów oszczędza gałęzi w miejscach, gdzie się mylą.
  const [open, setOpen] = useState<readonly number[]>([0]);

  function toggle(index: number) {
    setOpen((current) => {
      if (current.includes(index)) return current.filter((value) => value !== index);
      return content.allowMultiple ? [...current, index] : [index];
    });
  }

  return (
    <StructuredSectionShell
      type="faq"
      layout="accordion"
      background={content.background}
      heading={content.heading}
      styles={styles}
    >
      <div data-faq-list className="mt-8">
        {content.items.map((item, index) => {
          const expanded = open.includes(index);
          const trigger = `${id}-trigger-${index}`;
          const panel = `${id}-panel-${index}`;
          return (
            <div key={index} className={styles.faqItem}>
              {/* Element NAGŁÓWKOWY na zewnątrz, przycisk w środku (APG). */}
              <h3 aria-level={3} className="m-0">
                <button
                  type="button"
                  id={trigger}
                  data-faq-trigger={index}
                  aria-expanded={expanded}
                  aria-controls={panel}
                  onClick={() => toggle(index)}
                  className={cn(
                    styles.faqQuestion,
                    "flex w-full items-center justify-between gap-4 text-left",
                  )}
                >
                  <span>{bindOrphans(item.q)}</span>
                  {/* Znak stanu jest DEKORACJĄ — stan niesie `aria-expanded`,
                      więc czytnik nie usłyszy „plus” zamiast „zwinięte”. */}
                  <span aria-hidden="true" className="shrink-0 text-2xl leading-none font-normal">
                    {expanded ? "−" : "+"}
                  </span>
                </button>
              </h3>
              <div
                id={panel}
                data-faq-panel={index}
                role="region"
                aria-labelledby={trigger}
                hidden={!expanded}
                className="site-text-muted mt-3"
              >
                {/* Odpowiedź to TEKST najemcy, nie znaczniki — `SafeRichText`
                    robi z niej akapity bez `dangerouslySetInnerHTML`. */}
                <SafeRichText body={item.a} />
              </div>
            </div>
          );
        })}
      </div>
    </StructuredSectionShell>
  );
}
