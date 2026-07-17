-- 0017_tenant_resolution.sql
-- Rozwiązywanie storefrontu tenanta po subdomenie (Zadanie 2.1, ADR-039):
-- funkcja app.resolve_tenant_by_slug(slug) → id tenanta, wołana przez
-- middleware storefrontu ANONIMOWO (odwiedzający sklep nie ma sesji).
--
-- KONTEKST IZOLACJI. Storefront pod `<slug>.avably.io` musi zamienić slug z
-- hosta na tenant_id, zanim cokolwiek wyrenderuje. Odwiedzający jest anonimem
-- bez JWT, a public.tenants ma RLS (0001: odczyt tylko dla członka tenanta lub
-- superadmina — anon nie widzi żadnego wiersza). Bezpośredni SELECT z anona
-- zwróciłby więc zawsze pusto. Potrzebna jest wąska ścieżka SECURITY DEFINER,
-- która:
--   * przyjmuje slug i zwraca WYŁĄCZNIE id (żadnej nazwy, statusu, ustawień —
--     anon nie ma prawa do danych tenanta, a routing potrzebuje tylko id),
--   * zwraca id TYLKO dla tenanta „osiągalnego" (status trialing|active);
--     tenant suspended/cancelled/past_due/superadmin_locked jest dla publiczności
--     NIEODRÓŻNIALNY od nieistniejącego (funkcja zwraca NULL → middleware daje
--     neutralne 404). To jest bramka: nieaktywny sklep nie może być serwowany.
--
-- DLACZEGO NIE polityka RLS SELECT dla anona na tenants: taka polityka
-- wystawiłaby CAŁĄ tabelę tenants przez PostgREST (GET /rest/v1/tenants) i
-- pozwoliłaby anonowi enumerować slugi, nazwy i statusy wszystkich najemców.
-- RPC o ustalonej sygnaturze zwracającej sam uuid ma powierzchnię jednej
-- wartości — publiczność nie ma jak odczytać niczego poza „ten slug wskazuje
-- na jakiś aktywny tenant" (co i tak wynika z tego, że sklep się otwiera).
--
-- search_path przypięty (konwencja 0002/0003/0006): przy SECURITY DEFINER bez
-- przypięcia wywołujący mógłby podstawić własne obiekty pod nieskwalifikowane
-- nazwy i wykonać je z uprawnieniami właściciela funkcji. Odwołania i tak są
-- schema-kwalifikowane — przypięcie jest higieną, nie jedyną obroną.
--
-- Funkcja jest CZYTAJĄCA i deterministyczna w obrębie transakcji → STABLE, nie
-- VOLATILE: pozwala planerowi na cache w ramach zapytania i sygnalizuje, że nic
-- nie modyfikuje. Nie rzuca wyjątków (brak trafienia = NULL), więc nie dotyczy
-- jej problem „PostgREST zjada P0xxx do 500" — nie ma żadnego SQLSTATE do
-- przemycenia do klienta.

create or replace function app.resolve_tenant_by_slug(p_slug text)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select t.id
  from public.tenants t
  where t.slug = p_slug
    and t.status in ('trialing', 'active')
  limit 1;
$$;

comment on function app.resolve_tenant_by_slug(text) is
  'Routing storefrontu: slug subdomeny → id tenanta, wyłącznie dla statusu trialing|active (inaczej NULL). SECURITY DEFINER, bo odwiedzający sklep jest anonimem, a tenants ma RLS. Zwraca sam uuid — żadnych innych danych tenanta.';

-- Domyślnie CREATE FUNCTION nadaje EXECUTE roli PUBLIC. Zabieramy to i nadajemy
-- jawnie tylko rolom, które wołają funkcję: anon (odwiedzający sklep bez sesji)
-- i authenticated (zalogowany użytkownik panelu, który wchodzi na storefront —
-- ta sama ścieżka publiczna). Węższy grant = mniejsza powierzchnia.
revoke all on function app.resolve_tenant_by_slug(text) from public;
grant execute on function app.resolve_tenant_by_slug(text) to anon, authenticated;
