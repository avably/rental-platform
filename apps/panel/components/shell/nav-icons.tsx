import {
  Building2,
  CreditCard,
  Globe,
  LayoutDashboard,
  Mail,
  type LucideIcon,
  Package,
  ReceiptText,
  ScrollText,
  ShieldCheck,
  Store,
  Truck,
  Users,
} from "lucide-react";

/**
 * Ikony nawigacji (ADR-056). Jedyna baza ikon w produkcie to `lucide-react`
 * — decyzja właściciela z 2026-07-21; pakiet był już zależnością `@avably/ui`
 * (chevrony w Select/Dialog/Calendar), więc druga baza tylko dublowałaby wagę.
 *
 * Mapa jest tutaj, a nie w `lib/shell/nav.ts`, żeby definicja nawigacji
 * została czystymi danymi — kontrakt struktury importuje ją w środowisku node.
 */

/**
 * Jeden ciężar kreski w całym shellu. 1.75 zamiast domyślnych 2.0: artefakt
 * Fazy 2 rozdziela powierzchnie obrysem 1px i unika ciężkich plam, więc
 * domyślna kreska lucide przekrzykiwałaby etykietę stojącą obok.
 */
export const NAV_ICON_STROKE_WIDTH = 1.75;

export const NAV_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  orders: ReceiptText,
  catalog: Package,
  store: Store,
  domains: Globe,
  emails: Mail,
  delivery: Truck,
  contracts: ScrollText,
  payments: CreditCard,
  team: Users,
  organization: Building2,
  security: ShieldCheck,
};
