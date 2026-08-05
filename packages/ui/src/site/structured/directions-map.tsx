"use client";

import {
  directionsMapEmbedSrc,
  type DirectionsStructuredContent,
} from "@avably/core/site";
import { useId, useState } from "react";

import { cn } from "../../lib/cn";
import type { SiteRenderLabels } from "../types";
import { directionsLocationName } from "./directions-shared";

/**
 * MAPA ZA KLIKNIĘCIEM (E5, ADR-096) — sedno decyzji właściciela.
 *
 * ==================== DLACZEGO RAMKA NIE STOI OD RAZU ====================
 *
 * Osadzona mapa to ŻĄDANIE DO OBCEGO SERWISU wykonane przez przeglądarkę
 * odwiedzającego — z jego adresem IP, ciasteczkami tego serwisu i adresem
 * strony, na której stoi. Wykonane ZANIM ktokolwiek o mapę poprosił, jest
 * przekazaniem danych o wizycie w zamian za nic: większość odwiedzających
 * czyta adres i nigdy nie patrzy na mapę. Dochodzi waga strony — ramka mapy
 * ciągnie kilkaset kilobajtów skryptów i kafli, czyli więcej niż cała reszta
 * strony najemcy razem wzięta.
 *
 * Dlatego przed kliknięciem w drzewie NIE MA ANI RAMKI, ANI `preconnect`,
 * ANI `dns-prefetch` do dostawcy — a pilnuje tego kontrakt renderu, nie
 * komentarz. Kliknięcie jest zgodą wyrażoną czynem i dopiero ono montuje
 * `<iframe>`.
 *
 * ==================== PRZEŁĄCZNIK PUNKTÓW ====================
 *
 * Przy dwóch i więcej punktach nad mapą stoi wybór — GRUPA PRZYCISKÓW RADIO,
 * a nie zakładki (`tablist`). Zakładki przełączają PANELE TREŚCI; tu panel jest
 * jeden (mapa), a zmienia się WARTOŚĆ, którą on pokazuje, i dokładnie tak samo
 * czyta to czytnik ekranu („2 z 3"). Natywne `input[type=radio]` dają przy tym
 * chodzenie strzałkami i jeden zaznaczony element w grupie bez ani jednej linii
 * obsługi klawiatury — a własny `tablist` z ruchomym `tabindex` byłby kopią
 * tego zachowania, którą trzeba by testować u siebie.
 *
 * Przełączenie PO otwarciu mapy podmienia `src` tej samej ramki — bez drugiego
 * kliknięcia w „Pokaż mapę". Zgoda została już wyrażona; pytanie o nią drugi
 * raz przy tej samej sekcji byłoby uprzykrzaniem, a nie ochroną.
 */
export function DirectionsMapPanel({
  content,
  labels,
  mapEmbed = false,
  className,
}: {
  content: DirectionsStructuredContent;
  labels: SiteRenderLabels;
  /**
   * Czy WOLNO osadzić ramkę dostawcy map. Podaje ją wyłącznie sklep, bo tylko
   * jego polityka CSP wpuszcza to źródło (`maps` w @avably/security). Płótno
   * kreatora i podgląd szkicu stoją w panelu, który tego źródła NIE MA — więc
   * zamiast pustej ramki uciętej przez politykę pokazują zdanie o tym, co
   * zobaczy klient.
   */
  mapEmbed?: boolean;
  className?: string;
}) {
  const [current, setCurrent] = useState(0);
  const [open, setOpen] = useState(false);
  const group = useId();

  const items = content.items;
  // Wybór trzymamy INDEKSEM, więc skasowanie punktu na płótnie kreatora nie
  // zostawia wskaźnika w powietrzu — wracamy na pierwszy punkt zamiast paść.
  const location = items[current] ?? items[0]!;
  const name = directionsLocationName(location);

  return (
    <div data-directions-map className={cn("flex flex-col gap-3", className)}>
      {items.length > 1 ? (
        /*
          `fieldset` + `legend` to natywna grupa pól: czytnik ekranu zapowiada
          nazwę grupy przed każdą opcją, a my nie dopisujemy ani jednego
          atrybutu ARIA. Obramowanie zdejmujemy, bo to jest rząd chipów, a nie
          ramka formularza.
        */
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="site-label mb-2 p-0 text-sm">{labels.directionsChoose}</legend>
          <div className="flex flex-wrap gap-2">
            {items.map((item, index) => (
              <label
                key={`${item.address}-${index}`}
                data-directions-choice={index}
                className={cn(
                  "flex cursor-pointer items-center gap-2 text-sm",
                  // Obrys grupy fokusu bierze `currentColor` (atrament pasa albo
                  // tekst na akcencie), więc stan skupienia nie wnosi koloru,
                  // którego motyw nie zna.
                  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2",
                  /*
                   * Wybrany punkt jest przyciskiem GŁÓWNYM, pozostałe —
                   * drugorzędnymi. Obie klasy niosą kształt przycisku z MOTYWU
                   * (wypełnienie albo obrys, promień, odstęp wewnętrzny), więc
                   * chipy wyglądają jak reszta przycisków sklepu, a nie jak
                   * własny wynalazek tej sekcji.
                   */
                  index === current ? "site-cta" : "site-cta-secondary",
                )}
              >
                {/*
                  KÓŁKO ZOSTAJE WIDOCZNE, i to jest decyzja dostępnościowa.
                  Kusiło schować je (`sr-only`) i pokazywać wybór SAMYM
                  wyglądem chipa — ale kształt przycisku niesie MOTYW: w motywie
                  z przyciskiem obrysowym „główny" i „drugorzędny" różnią się
                  wyłącznie odcieniem tekstu, a przy akcencie równym atramentowi
                  nie różnią się niczym. Wybór byłby wtedy nie do zobaczenia
                  (WCAG 1.4.1). Natywne kółko mówi to samo w każdym motywie i bez
                  ani jednej reguły koloru: `accent-current` bierze atrament
                  chipa, więc kontrolka jest w kolorze napisu obok.
                */}
                <input
                  type="radio"
                  name={group}
                  className="size-4 shrink-0 accent-current"
                  checked={index === current}
                  onChange={() => setCurrent(index)}
                />
                {directionsLocationName(item)}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {open ? (
        mapEmbed ? (
          /*
            TYTUŁ RAMKI JEST OBOWIĄZKOWY (WCAG 4.1.2): bez niego czytnik ekranu
            zapowiada „ramka" i tyle. Niesie nazwę punktu, więc przy dwóch
            mapach na stronie da się je odróżnić słuchem.

            `loading="lazy"` — ramka zamontowana poniżej ekranu poczeka na
            przewinięcie; `referrerPolicy="no-referrer"` domyka decyzję
            prywatnościową od drugiej strony: skoro odwiedzający zgodził się
            zobaczyć mapę, dostawca dostaje zapytanie o miejsce, a nie adres
            podstrony, z której o nie poproszono.
          */
          <iframe
            data-directions-frame
            title={labels.directionsMapTitle.replace("{location}", name)}
            src={directionsMapEmbedSrc(location.address)}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="site-card aspect-[4/3] w-full @min-[32rem]/site:aspect-[16/9]"
          />
        ) : (
          <p data-directions-preview role="status" className="site-text-muted text-sm">
            {labels.directionsMapPreview}
          </p>
        )
      ) : (
        <>
          <button
            type="button"
            data-directions-show
            className="site-cta focus-visible:outline-2 focus-visible:outline-offset-2 w-fit cursor-pointer text-sm"
            onClick={() => setOpen(true)}
          >
            {labels.directionsShowMap}
          </button>
          {/*
            Zdanie o tym, co się stanie po kliknięciu. Nie jest ozdobą: to jest
            informacja, na której podstawie odwiedzający decyduje — bez niej
            „Pokaż mapę" wygląda na przycisk, który tylko coś rozwija.
          */}
          <p className="site-text-muted text-sm">{labels.directionsMapNotice}</p>
        </>
      )}
    </div>
  );
}
