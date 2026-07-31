"use client";

/**
 * PRAWA SZUFLADA „Ustawienia sekcji" (K1, ADR-083).
 *
 * W środku stoi DOTYCHCZASOWY formularz treści (`SectionContentForm`) — ten sam
 * kod, te same schematy `@avably/core/site`, ta sama akcja `upsertSection`.
 * K1 przenosi go z kolumny obok podglądu do szuflady OBOK PŁÓTNA i na tym
 * kończy: edycja W MIEJSCU (klik w tekst na płótnie) przychodzi z K2/K3 razem
 * ze schematem treści v2. Przepisywanie formularza teraz znaczyłoby wyrzucenie
 * go za dwa etapy.
 *
 * Baza szuflady to `Sheet` (Radix Dialog), więc pułapkę fokusu, Escape i powrót
 * fokusu na pasek narzędzi dostajemy z przetestowanego prymitywu.
 */
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@avably/ui";
import { useTranslations } from "next-intl";

import type { EditorSection } from "@/app/[locale]/(panel)/strona/content";
import { SectionContentForm } from "@/app/[locale]/(panel)/strona/section-content-form";
import { FormMeasure } from "@/components/screens/form-measure";

export function SectionSettingsDrawer({
  siteId,
  section,
  onClose,
  onSaved,
}: {
  siteId: string;
  /** Sekcja w edycji albo null — szuflada zamknięta. */
  section: EditorSection | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("site");

  return (
    <Sheet open={section !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent side="right" data-section-settings className="w-full gap-4 overflow-y-auto sm:max-w-md">
        {section ? (
          <>
            <SheetHeader>
              <SheetTitle>{t("builder.settingsTitle", { type: t(`sectionTypes.${section.type}`) })}</SheetTitle>
              <SheetDescription>{t("builder.settingsDescription")}</SheetDescription>
            </SheetHeader>
            {/*
              Szuflada jest po K1 JEDYNYM formularzem tego ekranu, więc to ona
              niesie wspólną miarę wiersza (P8). Szerokość samej szuflady jest
              dziś węższa niż miara — i dobrze: miara jest sufitem czytelności,
              a nie sposobem na rozepchnięcie panelu.

              `key` na id sekcji: formularz trzyma pola w stanie klienta, więc
              bez remontu przełączenie szuflady na INNĄ sekcję pokazywałoby
              wartości poprzedniej.
            */}
            <FormMeasure>
              <SectionContentForm key={section.id} siteId={siteId} section={section} onSaved={onSaved} />
            </FormMeasure>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
