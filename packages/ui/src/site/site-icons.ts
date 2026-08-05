import type { UspIcon } from "@avably/core/site";
import {
  BadgeCheck,
  CalendarCheck,
  Clock,
  CreditCard,
  Headphones,
  type LucideIcon,
  MapPin,
  Package,
  ShieldCheck,
  Sparkles,
  Star,
  ThumbsUp,
  Truck,
  Wrench,
} from "lucide-react";

/**
 * ALLOWLISTA IKON STRONY (ADR-082) → KOMPONENTY `lucide`.
 *
 * ==================== DLACZEGO OSOBNY PLIK (E7) ====================
 *
 * Mapa mieszkała w `sections.tsx` i to wystarczało, dopóki czytał ją jeden
 * render. Sekcja atutów v3 czyta ją jako DRUGI — a komponenty strukturalne mają
 * zamkniętą listę modułów, po które wolno im sięgać poza swój katalog
 * (`structured-role-usage.test.tsx`). Powód tej listy jest konkretny: każdy
 * nowy import to potencjalny producent klas motywu, który ominąłby skan ról.
 * `sections.tsx` producentem klas JEST, więc zamiast wpuszczać go na listę,
 * wyprowadzamy stąd samą mapę — dokładnie tak, jak E3 wyprowadził
 * `image-url.ts`.
 *
 * W tym pliku NIE MA ANI JEDNEJ KLASY: rozmiar, kolor i kafelek pod ikoną
 * ustawia komponent, który ją rysuje. Mapa mówi wyłącznie, który znak stoi pod
 * którą nazwą ze słownika.
 */
export const SITE_ICON_COMPONENTS: Record<UspIcon, LucideIcon> = {
  truck: Truck,
  "shield-check": ShieldCheck,
  clock: Clock,
  "badge-check": BadgeCheck,
  wrench: Wrench,
  headphones: Headphones,
  "map-pin": MapPin,
  "credit-card": CreditCard,
  package: Package,
  "calendar-check": CalendarCheck,
  sparkles: Sparkles,
  "thumbs-up": ThumbsUp,
};

/**
 * Znak dla nazwy ze słownika. Nazwa spoza mapy nie powinna przejść Zoda, ale
 * gdyby przeszła (treść zapisana przed zawężeniem słownika), render degraduje
 * do neutralnej gwiazdki — sekcja z jedną nieznaną ikoną nie może zabrać
 * klientowi całej strony.
 */
export function siteIconComponent(name: string): LucideIcon {
  return SITE_ICON_COMPONENTS[name as UspIcon] ?? Star;
}
