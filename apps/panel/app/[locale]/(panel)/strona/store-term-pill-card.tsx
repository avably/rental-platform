"use client";

/**
 * KARTA „KALENDARZ TERMINU W PASKU SKLEPU" (ADR-203) na ekranie stron.
 *
 * DLACZEGO TU, OBOK KART ZNAKU I WYGLĄDU. Flaga jest — jak znak (ADR-160)
 * i wygląd (ADR-161) — własnością NAJEMCY i dotyczy POWŁOKI całego sklepu,
 * nie żadnej ze stron. Ekran „Strona sklepu" jest jedynym miejscem panelu,
 * które odpowiada na pytanie „jak zachowuje się mój sklep u klienta", więc
 * trzecia własność powłoki staje w tym samym rzędzie, w którym stoją dwie
 * pierwsze. Ekran ustawień dostaw/płatności mówi o logistyce i pieniądzach —
 * przełącznik interfejsu sklepu byłby tam jedynym nie-swoim elementem.
 *
 * BEZ PARY SZKIC/PUBLIKACJA — świadomie, inaczej niż znak i wygląd obok:
 * to przełącznik ZACHOWANIA, nie treść. Zdanie o skutku („klienci widzą /
 * nie widzą") stoi przy przełączniku i zmienia się razem z nim, więc karta
 * nie ma jak opowiadać o stanie, którego nie zapisała — zapis nieudany
 * cofa przełącznik i pokazuje błąd.
 *
 * CZEGO TA FLAGA NIE WYŁĄCZA: widget rezerwacji na stronie sprzętu zostaje —
 * i dokładnie to mówi tekst pomocy, bo bez niego „wyłącz kalendarz" brzmi
 * jak „wyłącz sprzedaż".
 */
import { Checkbox, Label } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { saveStoreTermCalendarAction } from "./term-pill-actions";

export function StoreTermPillCard({ initialEnabled }: { initialEnabled: boolean }) {
  const t = useTranslations("site.termPill");

  const [enabled, setEnabled] = useState(initialEnabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(next: boolean) {
    setError(null);
    // Optymistycznie, z COFNIĘCIEM przy odmowie: przełącznik, który czeka na
    // sieć, wygląda na zepsuty — a przełącznik, który po odmowie zostaje
    // w nowej pozycji, kłamie o stanie sklepu.
    setEnabled(next);
    startTransition(async () => {
      const result = await saveStoreTermCalendarAction(next);
      if (!result.ok) {
        setEnabled(!next);
        setError(result.error);
      }
    });
  }

  return (
    <section
      data-store-term-pill
      data-store-term-pill-state={enabled ? "on" : "off"}
      className="border-border bg-card flex flex-col gap-1 rounded-lg border p-4"
    >
      <p className="text-sm font-medium">{t("title")}</p>
      <p className="text-muted-foreground text-[13px] leading-[18px]">{t("help")}</p>

      <Label className="mt-2 flex items-center gap-2 text-sm font-normal">
        <Checkbox
          checked={enabled}
          disabled={pending}
          data-store-term-pill-toggle
          onCheckedChange={(value) => save(value === true)}
        />
        {t("label")}
      </Label>

      {/* Zdanie o SKUTKU — z tego samego stanu, którym rysuje się przełącznik. */}
      <p
        data-store-term-pill-effect
        className="text-muted-foreground mt-1 text-[13px] leading-[18px]"
      >
        {enabled ? t("on") : t("off")}
      </p>

      {error ? (
        <p data-store-term-pill-error className="text-destructive mt-1 text-[13px] leading-[18px]">
          {error}
        </p>
      ) : null}
    </section>
  );
}
