"use client";

/**
 * RAMKA PODGLĄDU obok edytora (kreator A3) — chrome podglądu po stronie
 * edytora: nagłówek, przełącznik szerokości i sama ramka z trasą
 * `/podglad-strony`.
 *
 * DLACZEGO RAMKA, A NIE RENDER NA MIEJSCU: media queries storefrontu reagują
 * na szerokość OKNA. Podgląd renderowany bezpośrednio w kolumnie edytora
 * pokazywałby układ desktopowy ściśnięty do wąskiej kolumny, a przełącznik
 * „mobile" byłby wtedy dekoracją zamiast dowodem. Ramka niesie własny viewport
 * — wzorzec „viewport w ramce", bez udawania innej przeglądarki (żadnej
 * podmiany user-agenta: kłamalibyśmy o czymś, czego i tak nie sprawdzamy).
 *
 * ODŚWIEŻANIE JEST SYGNAŁEM, NIE ODPYTYWANIEM: `signal` rośnie po każdej
 * udanej mutacji szkicu (zapis sekcji, kolejność, włączenie, duplikat,
 * usunięcie, szablon). Nowa wartość zmienia zarówno `key`, jak i adres ramki,
 * więc dokument ładuje się od nowa — dokładnie raz na zmianę. Polling dawałby
 * ten sam efekt z opóźnieniem i stałym ruchem w tle, więc go tu nie ma.
 */
import { Button, cn } from "@avably/ui";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { getPathname } from "@/i18n/navigation";

/** Trasa dokumentu podglądu (grupa `(preview)`, poza shellem panelu). */
export const PREVIEW_PATHNAME = "/podglad-strony";

export type PreviewViewport = "desktop" | "mobile";

/**
 * Szerokości ramki. `mobile` to 390 px — szerokość CSS typowego telefonu, czyli
 * po stronie storefrontu punkt PONIŻEJ pierwszego breakpointa (`sm`, 640 px).
 * Desktop bierze całą kolumnę, bo o jego szerokości decyduje okno operatora.
 *
 * Wartość arbitralna (`w-[390px]`) ma jawną zgodę w kontrakcie spójności
 * ekranów (ADR-060): to nie jest przypięta szerokość EKRANU, tylko symulowany
 * viewport urządzenia — jedyna liczba, której nie da się wziąć ze skali, bo
 * bierze się z telefonu, a nie z naszej siatki.
 */
export const PREVIEW_VIEWPORT_CLASS: Record<PreviewViewport, string> = {
  desktop: "w-full",
  mobile: "w-[390px]",
};

export function SitePreviewFrame({
  signal,
  focusSectionId,
}: {
  /** Licznik zmian szkicu — każda nowa wartość przeładowuje ramkę. */
  signal: number;
  /** Sekcja, do której podgląd ma przewinąć po zapisie (null = bez skoku). */
  focusSectionId: string | null;
}) {
  const t = useTranslations("site.preview");
  const locale = useLocale();
  const [viewport, setViewport] = useState<PreviewViewport>("desktop");

  const src = getPathname({
    href: {
      pathname: PREVIEW_PATHNAME,
      query: { v: String(signal), ...(focusSectionId ? { focus: focusSectionId } : {}) },
    },
    locale,
  });

  return (
    <div data-site-preview="frame" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-[11px] leading-4 font-semibold tracking-[0.08em] uppercase">
          {t("eyebrow")}
        </p>
        <div
          role="group"
          aria-label={t("viewportLabel")}
          data-preview-viewport={viewport}
          className="flex items-center gap-1"
        >
          {(["desktop", "mobile"] as const).map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={viewport === option ? "default" : "secondary"}
              aria-pressed={viewport === option}
              onClick={() => setViewport(option)}
            >
              {t(`viewport_${option}`)}
            </Button>
          ))}
        </div>
      </div>
      <p className="text-muted-foreground text-[13px] leading-[18px]">{t("intro")}</p>
      {/*
        `overflow-x-auto`, nie `overflow-hidden`: w kolumnie węższej niż
        symulowany telefon ramka ma zostać przy SWOJEJ szerokości i dać się
        przesunąć, zamiast zostać przycięta albo — co gorsza — ściśnięta do
        szerokości kolumny. Ściśnięta pokazywałaby układ innego viewportu niż
        ten, który operator wybrał, czyli kłamałaby o wyniku przełącznika.
      */}
      <div className="border-border bg-card flex justify-center overflow-x-auto rounded-lg border">
        <iframe
          key={signal}
          data-preview-frame
          title={t("frameTitle")}
          src={src}
          className={cn(
            "h-[70vh] min-h-[480px] shrink-0 border-0",
            PREVIEW_VIEWPORT_CLASS[viewport],
            // Ramka węższa od kolumny dostaje boczne krawędzie, żeby było
            // widać, że to viewport telefonu, a nie urwana strona.
            viewport === "mobile" && "border-border border-x",
          )}
        />
      </div>
    </div>
  );
}
