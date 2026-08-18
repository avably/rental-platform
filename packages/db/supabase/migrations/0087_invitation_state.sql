-- ===== 0087 — STAN ZAPROSZENIA CZYTANY, NIE ZGADYWANY Z BŁĘDU (ADR-196) =====
--
-- CO: jedna funkcja odczytu `app.invitation_state(p_token)` — oddaje etykietę
-- stanu zaproszenia z ZAMKNIĘTEGO zbioru sześciu wartości:
--   'open' · 'not_found' · 'used' · 'revoked' · 'expired' · 'email_mismatch'.
--
-- DLACZEGO: odmowy `app.accept_invitation` (P0003–P0007) rozróżniają sześć
-- stanów własnymi kodami, ale PostgREST zjada klasę P0xxx do gołego HTTP 500
-- z ciałem `Something went wrong` — bez kodu i bez treści (sonda na żywym
-- stacku 2026-08-18, spójna z nagłówkami 0007/0011/0051). Paczka P1 (ADR-193
-- D6) dała ludzki, ale JEDEN komunikat dla wszystkich odmów, bo klasyfikacja
-- wymaga ODCZYTU wiersza zaproszenia, a wszystkie drogi były zamknięte: RLS
-- `tenant_select` (0001/0060) widzi wiersz wyłącznie członkom tenanta
-- (zapraszany nim nie jest), a klient service-role jest w ścieżkach żądań
-- ZAKAZANY (kwarantanna ADR-099). Ta migracja otwiera drogę CZWARTĄ, wąską:
-- czytelny RPC stanu — dokładnie wariant nazwany w ADR-193 jako czekający
-- na rozstrzygnięcie PM. „Zaproszenie wygasło" i „wystawione na inny adres"
-- to dwie różne instrukcje dla człowieka; dziś dostaje jedną.
--
-- SKĄD WZIĘTE ZACHOWANIE: warunki i ich KOLEJNOŚĆ są przepisane 1:1
-- z najnowszej definicji `app.accept_invitation` (0051, ADR-105 D3):
-- nie istnieje → wykorzystane → odwołane → wygasłe → inny adres → otwarte.
-- Kolejność jest kontraktem, nie kosmetyką (odwołanie bije wygaśnięcie:
-- decyzja ownera jest faktem mocniejszym niż upływ czasu i komunikat nie ma
-- sugerować, że wystarczy poprosić o przedłużenie). Zgodności etykiet z
-- faktycznym zachowaniem accept_invitation pilnuje test na żywej bazie
-- (packages/db/test/invitation-state.test.ts) — para stan↔kod dla każdego
-- z sześciu stanów, żeby ta funkcja nie stała się drugim źródłem prawdy.
--
-- DLACZEGO NOWA FUNKCJA, A NIE ZMIANA `accept_invitation`: ciało akceptu
-- jest jednym miejscem prawdy o warunkach WEJŚCIA do tenanta i ma komplet
-- testów (lifecycle-guards, auth-hook); `create or replace` na nim niósłby
-- ryzyko cichego cofnięcia poprawek z 0051 (klasa błędu z lekcji
-- „create or replace: szukaj OSTATNIEJ definicji"). Odczyt stanu to inna
-- odpowiedzialność: zero mutacji, zero blokad (STABLE, bez FOR UPDATE).
--
-- TOKEN = UPRAWNIENIE (jak w accept_invitation): kto ma surowy token
-- z wiadomości e-mail, ten może zapytać o stan TEGO zaproszenia — wyszukanie
-- idzie po sha256(token), nigdy po identyfikatorze ani adresie. Granty na
-- `public.invitations` NIE zmieniają się: anon nie ma ich wcale, authenticated
-- ma granty tabelowe z 0001, ale RLS `tenant_select` pokazuje wiersze
-- wyłącznie członkom tenanta — zapraszany przed akceptem nie widzi NIC.
-- Jedyną drogą zapraszanego pozostaje więc ta funkcja.
--
-- ZERO DANYCH PONAD STAN (ADR-181): funkcja NIE oddaje e-maila, nazwy
-- najemcy, roli ani żadnych identyfikatorów — wyłącznie etykietę text
-- z zamkniętego zbioru. Wyciek „na kogo wystawiono zaproszenie" byłby
-- regresem względem ADR-181 (odmowa nie jest nośnikiem danych). Etykieta
-- 'email_mismatch' mówi zalogowanemu posiadaczowi tokenu, że jego sesja ma
-- inny adres niż zaproszenie — NIE mówi, jaki adres ma zaproszenie; to samo
-- posiadacz tokenu dostaje dziś z P0006 akceptu.
--
-- BRAK SESJI: rozstrzygnięcie 'email_mismatch' wymaga adresu sesji
-- (auth.uid() → auth.users.email). Bez sesji funkcja oddaje stan tokenu BEZ
-- tego rozstrzygnięcia ('open' dla żywego zaproszenia) — strona akceptacji
-- i tak przekierowuje niezalogowanych na logowanie, a grant EXECUTE i tak
-- ma wyłącznie authenticated. Gałąź jest w ciele świadomie (odporność na
-- przyszłe rozszerzenie grantu, zerowy koszt).
--
-- OKNO WDROŻENIOWE: nowa funkcja o własnej sygnaturze, której w oknie nikt
-- nie woła (kod panelu wchodzi dopiero mergem PO migracji). Żadna istniejąca
-- funkcja, tabela, polityka ani grant tabelowy nie zmienia się — stary kod
-- panelu nie widzi tej migracji w ogóle. Bezpieczne w obie strony.

-- === BEGIN PROD MIGRATION 0087 ===

-- ---------------------------------------------------------------------
-- app.invitation_state — etykieta stanu zaproszenia dla posiadacza tokenu
-- ---------------------------------------------------------------------
--
-- SECURITY DEFINER: zapraszany nie jest członkiem tenanta, więc RLS
-- `tenant_select` na public.invitations nie pokaże mu wiersza (to samo
-- „jajko i kura" co w accept_invitation, 0003). Uprawnieniem jest posiadanie
-- surowego tokenu; funkcja czyta też auth.users (adres sesji), do którego
-- rola authenticated nie ma grantu.
--
-- STABLE + zwykły SELECT (bez FOR UPDATE): odczyt nie blokuje wiersza i nie
-- serializuje się z akceptem; chwilowa niespójność odczyt→akcept jest
-- nieszkodliwa, bo bramką pozostaje accept_invitation — panel klasyfikuje
-- stan dopiero PO jego odmowie, a proaktywny ekran tylko oszczędza klik.
create function app.invitation_state(p_token text)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth, app
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_invitation record;
begin
  select i.accepted_at, i.revoked_at, i.expires_at, i.email
    into v_invitation
  from public.invitations i
  where i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');

  -- Kolejność rozstrzygania = kolejność warunków accept_invitation (0051).
  if not found then
    return 'not_found';
  end if;

  if v_invitation.accepted_at is not null then
    return 'used';
  end if;

  if v_invitation.revoked_at is not null then
    return 'revoked';
  end if;

  if v_invitation.expires_at <= now() then
    return 'expired';
  end if;

  -- Bez sesji nie ma czego porównać — oddajemy stan tokenu bez rozstrzygania
  -- adresu (patrz nagłówek: BRAK SESJI). Porównanie adresów co do znaku jak
  -- w accept_invitation (lower + coalesce '').
  if v_user_id is not null then
    select u.email into v_user_email from auth.users u where u.id = v_user_id;
    if lower(v_invitation.email) <> lower(coalesce(v_user_email, '')) then
      return 'email_mismatch';
    end if;
  end if;

  return 'open';
end;
$$;

comment on function app.invitation_state(p_token text) is
  'Etykieta stanu zaproszenia dla posiadacza surowego tokenu (0087, ADR-196): open / not_found / used / revoked / expired / email_mismatch — zamknięty zbiór, zero danych ponad stan (ADR-181). Warunki i kolejność przepisane 1:1 z app.accept_invitation (0051); zgodności pilnuje invitation-state.test.ts na żywej bazie. SECURITY DEFINER (zapraszany nie widzi wiersza przez RLS), STABLE, bez FOR UPDATE — bramką wejścia pozostaje wyłącznie accept_invitation. email_mismatch rozstrzygane wobec adresu sesji (auth.uid()); bez sesji oddaje stan tokenu bez tego rozstrzygnięcia.';

-- Konwencja revoke-from-public (docs/konwencje-migracji.md, 0064):
-- create function nadaje EXECUTE roli PUBLIC domyślnie, a schemat app jest
-- wystawiony przez PostgREST.
revoke all on function app.invitation_state(text) from public, anon, authenticated;

-- authenticated: obaj konsumenci (strona akceptacji i akcja „Dołącz")
-- działają WYŁĄCZNIE z sesją — niezalogowanych panel przekierowuje na
-- logowanie, zanim cokolwiek zapyta o stan. anon celowo BEZ grantu: mniejsza
-- powierzchnia (bramka function-acls.test.ts nie potrzebuje wpisu
-- w allowliście anon), a scenariusz „stan przed zalogowaniem" dziś nie
-- istnieje w żadnej trasie.
grant execute on function app.invitation_state(text) to authenticated;

-- === END PROD MIGRATION 0087 ===
