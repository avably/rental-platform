"use client";

/**
 * Przewinięcie ramki podglądu do WŁAŚNIE ZAPISANEJ sekcji (kreator A3).
 *
 * Sekcja przychodzi parametrem adresu (`?focus=<id>`), a nie wiadomością od
 * rodzica, bo ramka i tak przeładowuje się po każdym zapisie — parametr jest
 * wtedy częścią tego samego zdarzenia, zamiast wyścigu „załaduj, potem
 * doślij". Kotwice (`data-section-id`) niesie renderer wspólny ze
 * storefrontem.
 *
 * Bez `focus` komponent nie robi NIC — podgląd zostaje tam, gdzie stoi
 * (zmiana szablonu czy publikacja nie mają sekcji, do której warto skakać).
 */
import { useEffect } from "react";

export function ScrollToSection({ sectionId }: { sectionId: string | null }) {
  useEffect(() => {
    if (!sectionId) return;
    const target = document.querySelector(`[data-section-id="${CSS.escape(sectionId)}"]`);
    // `auto`, nie `smooth`: podgląd ma być na miejscu, zanim operator zdąży
    // spojrzeć — animacja przewijania po przeładowaniu wygląda jak zacięcie.
    target?.scrollIntoView({ behavior: "auto", block: "start" });
  }, [sectionId]);

  return null;
}
