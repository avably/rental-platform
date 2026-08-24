-- 0105 — TYP SEKCJI „categories" (Faza 7, ADR-259)
--
-- Nowy typ sekcji kreatora: „kategorie" — kafle kategorii z banerem
-- (`image_path`, Faza D / 0103) linkujące do strony kategorii
-- (`/kategoria/{slug}`, Faza C / 0101). Sekcja jest strukturalna (v3), a jej
-- treścią jest KATALOG kategorii, nie własna lista wpisów — dlatego migracja
-- dotyka WYŁĄCZNIE listy dozwolonych typów, bez nowej tabeli i bez RLS.
--
-- ---------------------------------------------------------------------
-- CHECK site_sections.type — DOŁOŻENIE 'categories'
-- ---------------------------------------------------------------------
--
-- Wzorzec bez zmian względem 0043/0047: Postgres nie zna „dopisz wartość do
-- CHECK-a", więc lista jedzie od nowa, a drop + add stoją w jednym kroku.
-- Nowa lista jest NADZBIOREM starej (dokłada tylko 'categories'), więc żaden
-- istniejący wiersz nie może naruszyć nowego ograniczenia — walidacja przy
-- `add constraint` przejdzie po całej tabeli i nie ma prawa niczego znaleźć.

alter table public.site_sections
  drop constraint if exists site_sections_type_check;

alter table public.site_sections
  add constraint site_sections_type_check check (
    type in (
      'hero', 'products', 'categories', 'pricing', 'faq', 'contact',
      'freeform', 'testimonials', 'gallery', 'usp', 'cta', 'directions',
      'delivery', 'footer'
    )
  );

comment on constraint site_sections_type_check on public.site_sections is
  'Zamknięta lista typów sekcji — lustro SECTION_TYPES z @avably/core/site (ADR-041/ADR-082/ADR-092/ADR-259). Nowy typ = zmiana tego CHECK-a + schemat Zod w core.';
