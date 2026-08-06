/**
 * WSTRZYKNIĘCIE SKRYPTU UZBRAJAJĄCEGO — OSOBNY PLIK, I TO JEST DECYZJA.
 *
 * Render sekcji stoi pod kontacktem „w renderze NIE MA drogi do wstrzyknięcia
 * HTML-u" (`rich-text-render.test.tsx`, K3/ADR-086): skan źródeł renderu odrzuca
 * `dangerouslySetInnerHTML`, bo treść operatora ma być TEKSTEM, nigdy
 * znacznikiem. Skrypt wejścia sekcji (ADR-097) musi jednak trafić do dokumentu
 * inline — inaczej wykona się po pierwszym malowaniu i treść mignie.
 *
 * Zamiast rozszczelniać skan dla całego renderera, wydzielamy JEDNO miejsce,
 * w którym wstrzyknięcie jest dozwolone, i obkładamy je własnym kontraktem:
 *
 *   • wstrzykiwana jest WYŁĄCZNIE stała {@link SITE_REVEAL_SCRIPT} — nie ma tu
 *     ani interpolacji, ani żadnej wartości pochodzącej od najemcy;
 *   • plik nie przyjmuje treści: jedyny props to `nonce`, który jedzie
 *     ATRYBUTEM, czyli drogą, którą React sam escape'uje;
 *   • skan renderu pilnuje reszty źródeł bez zmian.
 *
 * Różnica jest merytoryczna, a nie formalna: kontrakt broni przed tym, żeby
 * DANE stały się znacznikiem. Tu do dokumentu wchodzi KOD, który napisaliśmy,
 * ten sam co do bajta przy każdym żądaniu.
 */
import { SITE_REVEAL_SCRIPT } from "./site-reveal";

export function SiteRevealScript({ nonce }: { nonce: string }) {
  return (
    /*
     * `suppressHydrationWarning`: przeglądarka CZYŚCI atrybut `nonce` z DOM-u
     * zaraz po wykonaniu skryptu (ochrona przed wyciekiem wartości do JS-a
     * strony), więc React przy hydracji widzi rozjazd między swoim drzewem
     * a dokumentem. Ten sam zapis stoi przy skrypcie motywu w panelu.
     */
    <script
      nonce={nonce}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: SITE_REVEAL_SCRIPT }}
    />
  );
}
