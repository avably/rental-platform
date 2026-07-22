/**
 * Wariant BŁĘDU ŁADOWANIA szkicu (P8b — kotwica `data-site-load-error-state`
 * z mockupu `secondary-site-editor`).
 *
 * Osobny komponent, a nie akapit w `page.tsx`, z jednego powodu: mockup mówi
 * wprost „nie pokazuj pustego edytora jako poprawnego stanu”. Edytor bez sekcji
 * i edytor, którego szkicu nie udało się pobrać, wyglądają identycznie, a
 * znaczą coś przeciwnego — pierwszy zaprasza do dodania sekcji, drugi mówi, że
 * treść MOŻE ISTNIEĆ i właśnie jej nie widać. Wydzielenie daje temu stanowi
 * własną kotwicę i własny test renderu.
 */
import { ScreenBackLink, ScreenSection } from "@/components/screens/screen-header";
import { FormMeasure } from "@/components/screens/form-measure";

export function SiteLoadError({
  backLabel,
  title,
  message,
}: {
  backLabel: string;
  title: string;
  message: string;
}) {
  return (
    <FormMeasure className="flex flex-col gap-4">
      <ScreenBackLink href="/" label={backLabel} />
      <ScreenSection data-site-load-error-state title={title}>
        <p role="alert" className="text-destructive text-sm">
          {message}
        </p>
      </ScreenSection>
    </FormMeasure>
  );
}
