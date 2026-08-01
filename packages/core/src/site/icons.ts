/**
 * Allowlista ikon strony (ADR-082): zamknięty zbiór nazw z biblioteki `lucide`,
 * mapowany na komponenty w renderze (@avably/ui). Zamknięcie listy to oś
 * bezpieczeństwa i spójności — treść tenanta nie może wskazać dowolnego,
 * nieznanego renderowi symbolu ani (w przyszłości) obcego zasobu. Kolejność
 * bez znaczenia; nazwy w kebab-case, tłumaczone na komponent po stronie UI.
 *
 * OSOBNY MODUŁ, a nie stała w `index.ts`, bo korzystają z niej DWA schematy
 * z dwóch plików: sekcja USP (v1) i element `icon` płótna v2 (K2, ADR-084).
 * Trzymanie jej w `index.ts` zamykałoby cykl wartości `index → elements →
 * index`, w którym re-eksport jest hoistowany i schemat ikony byłby jeszcze
 * niezdefiniowany w chwili budowania schematów elementów.
 */
import { z } from "zod";

export const USP_ICONS = [
  "truck",
  "shield-check",
  "clock",
  "badge-check",
  "wrench",
  "headphones",
  "map-pin",
  "credit-card",
  "package",
  "calendar-check",
  "sparkles",
  "thumbs-up",
] as const;
export type UspIcon = (typeof USP_ICONS)[number];
export const uspIconSchema = z.enum(USP_ICONS);
