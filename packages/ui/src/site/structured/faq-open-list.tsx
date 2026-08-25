import type { FaqStructuredContent } from "@avably/core/site";

import { SafeRichText } from "../rich-text";
import type { TemplateStyles } from "../template";
import { StructuredSectionShell } from "./shell";
import { bindOrphans } from "../orphans";

/**
 * FAQ — UKŁAD „LISTA OTWARTA” (E1, ADR-094).
 *
 * Ten sam `items`, inny sposób czytania: wszystkie odpowiedzi widoczne, zero
 * przycisków, zero stanu. To nie jest „accordion z otwartymi wszystkimi” —
 * to układ, w którym NIE MA CO zwijać, więc nie ma też przycisków, których
 * naciśnięcie niczego by nie zmieniało.
 *
 * KOMPONENT SERWEROWY (brak `"use client"`) i to jest cała jego przewaga:
 * strona najemcy, która wybrała ten układ, nie dostaje ANI JEDNEGO skryptu
 * z sekcji FAQ. Dlatego układy siedzą w osobnych plikach, a nie w jednym
 * z gałęzią po `layout`.
 *
 * Nagłówki par są `<h3>` jak w accordionie — hierarchia dokumentu nie może
 * zależeć od wybranego wyglądu.
 */
export function StructuredFaqOpenList({
  content,
  styles,
}: {
  content: FaqStructuredContent;
  styles: TemplateStyles;
}) {
  return (
    <StructuredSectionShell
      type="faq"
      layout="open-list"
      background={content.background}
      heading={content.heading}
      styles={styles}
    >
      <dl data-faq-list className="mt-8">
        {content.items.map((item, index) => (
          <div key={index} className={styles.faqItem}>
            <dt>
              <h3 aria-level={3} className={styles.faqQuestion}>
                {bindOrphans(item.q)}
              </h3>
            </dt>
            <dd data-faq-panel={index} className="site-text-muted mt-3 ml-0">
              <SafeRichText body={item.a} />
            </dd>
          </div>
        ))}
      </dl>
    </StructuredSectionShell>
  );
}
