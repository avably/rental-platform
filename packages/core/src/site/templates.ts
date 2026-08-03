/**
 * Szablony graficzne strony — LIŚĆ drzewa importów (K5, ADR-090).
 *
 * Stała mieszkała w `./index`, ale od K5 potrzebuje jej także `./style`
 * (szablon jest polem stylu strony), a `./index` re-eksportuje `./style` —
 * czyli cykl. Cykl w samych TYPACH byłby nieszkodliwy, ale `z.enum(SITE_TEMPLATES)`
 * czyta wartość W CHWILI ŁADOWANIA MODUŁU: przy zapętleniu tablica bywa jeszcze
 * `undefined` i schemat powstaje pusty, co widać dopiero jako odrzucony zapis.
 *
 * Wydzielenie jest tym samym ruchem, którym `./icons` zamknęło cykl między
 * `./index` a `./elements` (allowlista ikon USP) — i z tego samego powodu.
 *
 * Lustro CHECK-a `sites.template` (0019). Nowy szablon = zmiana tej stałej,
 * zestawu klas w `@avably/ui` (template.ts) ORAZ CHECK-a w migracji.
 */
import { z } from "zod";

export const SITE_TEMPLATES = ["classic", "bold"] as const;
export type SiteTemplate = (typeof SITE_TEMPLATES)[number];
export const siteTemplateSchema = z.enum(SITE_TEMPLATES);
