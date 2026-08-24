/**
 * MENU KATEGORII SKLEPU — pozycje nawigacji zbudowane z taksonomii katalogu
 * (ADR-247, Faza D).
 *
 * ==================== PO CO TO ISTNIEJE ====================
 *
 * Kategoria najemcy dostaje w Fazie C własny adres w sklepie
 * (`/kategoria/{slug}`), ale sam adres nie prowadzi do niego znikąd: nagłówek
 * sklepu do tej pory niósł wyłącznie znak firmy i koszyk. Menu kategorii jest
 * mostem między jednym a drugim — listą wejść do półek oferty, budowaną
 * z kategorii, które najemca już założył, w JEGO kolejności (`position`).
 *
 * ==================== GUARD PUSTEJ KATEGORII ====================
 *
 * Kategoria bez ani jednej pozycji NIE WCHODZI do menu. Powód jest w naturze
 * odnośnika: pozycja menu obiecuje półkę oferty, a półka bez sprzętu to ślepy
 * zaułek — klient klika „Namioty", trafia na „w tej kategorii nic nie ma"
 * i wraca. Strona kategorii dla takiego wejścia dalej ISTNIEJE (Faza C rysuje
 * pusty widok, nie 404 — operator ją założył), ale nie ma powodu ZAPRASZAĆ do
 * niej z menu. Liczbę pozycji liczymy z `category_ids` przy produkcie — tego
 * samego pola, którym katalog wiąże sprzęt z taksonomią (0072) — więc menu nie
 * potrzebuje ani jednego dodatkowego odczytu.
 *
 * ==================== ADRES POCHODZI Z FAZY C ====================
 *
 * Segment `/kategoria` i budowa adresu żyją przy trasie kategorii
 * (`category-path.ts`, Faza C, ADR-247) — importujemy stamtąd `categoryBasePath`,
 * żeby druga kopia nazwy segmentu nie rozjechała się po cichu z pierwszą. Segment
 * jest zarezerwowany w rdzeniu (`RESERVED_CATEGORY_SLUGS`), a link menu prowadzi
 * do CZYSTEJ strony kategorii (bez numeru strony i sortu).
 */
import { categoryBasePath } from "@/lib/catalog/category-path";
import type { PublicCategory } from "@/lib/checkout/contract";

/** Pozycja menu kategorii — gotowa do wyrenderowania, bez wiedzy o katalogu. */
export interface CategoryNavItem {
  id: string;
  name: string;
  slug: string;
  href: string;
  /** Ile pozycji katalogu należy do tej kategorii (zawsze ≥ 1 w wyniku). */
  count: number;
}

/**
 * Wejście DOKŁADNIE dwie rzeczy z katalogu, nazwane wprost (nie cały
 * `PublicCatalog`), żeby funkcja przyjmowała i kopertę odczytu, i fikstury
 * testów bez zbędnego balastu.
 */
export interface CategoryNavInput {
  categories: readonly PublicCategory[];
  products: readonly { category_ids: readonly string[] }[];
}

/**
 * Pozycje menu kategorii w kolejności najemcy, WYŁĄCZNIE dla kategorii
 * z co najmniej jedną pozycją (patrz „guard pustej kategorii" w nagłówku).
 *
 * Liczbę pozycji zliczamy raz, jednym przejściem po produktach: `category_ids`
 * niesie identyfikatory kategorii, do których należy sprzęt, więc suma po
 * katalogu daje licznik per kategoria bez pytania bazy o drugi odczyt.
 */
export function categoryNavItems(catalog: CategoryNavInput): CategoryNavItem[] {
  const counts = new Map<string, number>();
  for (const product of catalog.products) {
    for (const categoryId of product.category_ids) {
      counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
    }
  }

  const items: CategoryNavItem[] = [];
  for (const category of catalog.categories) {
    const count = counts.get(category.id) ?? 0;
    if (count === 0) continue;
    items.push({
      id: category.id,
      name: category.name,
      slug: category.slug,
      href: categoryBasePath(category.slug),
      count,
    });
  }
  return items;
}
