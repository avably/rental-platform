import type { SectionBackground } from "@avably/core/site";
import type { ReactNode } from "react";

import { cn } from "../../lib/cn";
import { sectionBandClass } from "../bands";
import type { TemplateStyles } from "../template";

/**
 * POWŁOKA SEKCJI STRUKTURALNEJ (E1, ADR-094).
 *
 * Jedno miejsce, w którym powstaje `<section>` sekcji v3: odstępy, kontener
 * czytelności, pas motywu i nagłówek. Komponenty typów (FAQ, a po nich
 * galeria, cennik…) dostają tu gotowe ramy i zajmują się WYŁĄCZNIE swoją
 * mechaniką — inaczej każdy nowy typ przynosiłby własną, minimalnie inną
 * interpretację odstępu i pasa.
 *
 * ZERO HEKSÓW. Wszystko, co ma kolor, bierze go z ról motywu przez klasy
 * arkusza (`site-*`) — pilnuje tego bramka „bez heksów” w kontrakcie renderu,
 * a czytelność ról liczy macierz kontrastu po deklaracji w rejestrze.
 *
 * `data-structured-section` / `data-structured-layout` to kotwice testów,
 * zrzutów i warstwy edycyjnej kreatora — nie dekoracja.
 */
export function StructuredSectionShell({
  type,
  layout,
  background,
  heading,
  styles,
  children,
}: {
  type: string;
  layout: string;
  background: SectionBackground;
  heading?: string;
  styles: TemplateStyles;
  children: ReactNode;
}) {
  return (
    <section
      data-structured-section={type}
      data-structured-layout={layout}
      className={cn(styles.section, sectionBandClass(background, styles))}
    >
      {/*
       * `data-section-reveal` — PUDEŁKO TREŚCI, czyli podmiot animacji wejścia
       * (addendum E9). Znacznik stoi na kontenerze, a nie na pasie, bo pas ma
       * 80 px pustego marginesu u góry: oś widoku liczona od jego krawędzi
       * przepalała ~85% przebiegu, zanim pierwsza litera wjechała w okno.
       *
       * WARIANT WYNIKA Z NAGŁÓWKA. Kaskada „nagłówek → reszta" potrzebuje co
       * najmniej dwojga dzieci; sekcja bez nagłówka oddaje do kontenera jeden
       * blok (tak wygląda baner CTA), więc kaskada nie miałaby czego kaskadować
       * i udawałaby ruch, którego nie ma. Bez nagłówka pudełko wchodzi więc
       * jako całość.
       */}
      <div data-section-reveal={heading ? "stagger" : "block"} className={styles.container}>
        {heading ? <h2 className={styles.sectionHeading}>{heading}</h2> : null}
        {children}
      </div>
    </section>
  );
}
