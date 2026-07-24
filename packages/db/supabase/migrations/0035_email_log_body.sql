-- 0035_email_log_body.sql
-- ADR-073: historia komunikacji trzyma TREŚĆ wiadomości, nie tylko metadane.
-- Świadome ODWRÓCENIE decyzji z 0021 (uwaga właściciela D10).
--
-- ---------------------------------------------------------------------
-- CO TA MIGRACJA COFA I DLACZEGO
-- ---------------------------------------------------------------------
--
-- 0021 zapisała wprost: „BEZ TREŚCI WIADOMOŚCI: zapisujemy metadane
-- (rodzaj, odbiorca, temat), nigdy html/text. Treść to duplikat szablonu
-- powiększony o dane osobowe klienta, rosnący z każdą wysyłką — a do
-- diagnozy »czy i dlaczego« nie jest potrzebny."
--
-- To rozumowanie było poprawne dla pytania, które 0021 sobie postawiła
-- („czy wyszło i dlaczego nie"), i jest za wąskie dla pytania, które zadaje
-- operator lady w sporze z klientem: „co dokładnie klient dostał". Na to
-- pytanie metadane nie odpowiadają w ogóle, a odtworzenie treści z szablonu
-- PO FAKCIE odpowiada na nie ŹLE: szablon, cennik, dane tenanta i sam
-- generator zmieniają się w czasie, więc rekonstrukcja pokazuje wiadomość,
-- której klient nigdy nie widział — i robi to bez ostrzeżenia. Rejestr,
-- który wygląda na dowód, a dowodem nie jest, jest gorszy niż jego brak
-- (to samo zdanie, którym 0021 uzasadniała append-only).
--
-- Argument „duplikat szablonu" zostaje przyjęty i skwitowany: tak, to
-- duplikat, i to jest CAŁA jego wartość. Kopia bierze się z tego samego
-- obiektu, który poszedł do dostawcy (`sendAndLog` zapisuje `email.html`
-- TEJ SAMEJ wiadomości, którą poda transportowi), więc jest zapisem
-- zdarzenia, a nie kolejnym renderem szablonu.
--
-- ---------------------------------------------------------------------
-- ROZSTRZYGNIĘCIA
-- ---------------------------------------------------------------------
--
-- 1. KOLUMNA NULLABLE, BEZ WARTOŚCI DOMYŚLNEJ. Wiersze sprzed tej migracji
--    treści NIE MAJĄ i nigdy mieć nie będą — nie ma z czego jej wziąć.
--    `default ''` byłby najgorszym z możliwych wyjść: ekran pokazałby pustą
--    wiadomość zamiast powiedzieć „treści nie mamy", czyli skłamałby o tym,
--    co poszło do klienta. NULL znaczy tu „nie zapisaliśmy", nie „puste".
--
-- 2. BEZ CHECK-a NA DŁUGOŚĆ. Kusi ograniczyć rozmiar, ale skutek byłby
--    odwrotny do zamierzonego: zapis logu jest krokiem PO wysyłce i jego
--    błąd jest połykany (`sendAndLog`, ADR-045), więc przekroczenie limitu
--    nie odrzuciłoby treści — odrzuciłoby CAŁY wpis, razem z metadanymi
--    i powodem błędu. Wiadomość z obrazkami inline zniknęłaby wtedy
--    z historii bez śladu. text/TOAST radzi sobie z tym sam.
--
-- 3. FUNKCJA `email_log_has_body` — KOLUMNA WYLICZANA PostgREST-a.
--    Ekran zamówienia potrzebuje na LIŚCIE jednej informacji: czy przy tym
--    wpisie jest co pokazywać. Pobieranie w tym celu treści wszystkich
--    wiadomości zamówienia oznaczałoby wysłanie kilkuset kilobajtów cudzej
--    korespondencji do przeglądarki przy KAŻDYM otwarciu zamówienia — także
--    wtedy (czyli prawie zawsze), gdy operator nie klika w żaden podgląd.
--    Treść schodzi więc na żądanie, osobnym odczytem, a lista dostaje sam
--    bit. To ta sama zasada, którą 0021 zapisała przy danych osobowych:
--    mniej danych w obiegu, gdy nikt ich nie potrzebuje.
--
-- 4. RLS BEZ ZMIAN. `body` to kolejna kolumna tej samej tabeli pod tymi
--    samymi politykami z 0021 (odczyt: członek tenanta lub superadmin;
--    zapis: członek tenanta; brak UPDATE/DELETE poza service_role). Ta
--    migracja NIE otwiera żadnej nowej powierzchni: anon nie ma i nie
--    dostaje grantu na tabelę, a funkcja wyliczana czyta WYŁĄCZNIE wiersz,
--    który wołający i tak już przeszedł przez politykę.

-- ---------------------------------------------------------------------
-- 1. Kolumna treści
-- ---------------------------------------------------------------------

alter table public.email_logs
  add column if not exists body text;

comment on column public.email_logs.body is
  'Treść HTML wiadomości DOKŁADNIE w postaci przekazanej dostawcy poczty (kopia OutgoingEmail.html z tej samej próby wysyłki, ADR-073). NULL = wpis sprzed 0035 albo wysyłka bez rejestratora treści — znaczy „nie zapisaliśmy", NIGDY „pusta wiadomość". DANE OSOBOWE: treść niesie dane klienta (jak recipient, ADR-045 D3) — ta sama retencja 24 miesięcy, ten sam zakaz wynoszenia poza panel tenanta.';

-- Komentarz tabeli z 0021 głosił „Metadane bez treści wiadomości" — po tej
-- migracji byłby nieprawdą, a komentarz, który kłamie, jest gorszy od jego
-- braku (czyta go każdy audyt schematu).
comment on table public.email_logs is
  'Historia prób wysyłki e-maili per tenant (ADR-045, ADR-073): sukces (sent + provider_message_id) i porażka (failed + error), wraz z TREŚCIĄ wysłanej wiadomości (body, od 0035). APPEND-ONLY — bez grantów i polityk UPDATE/DELETE. order_id nullable: zaproszenie nie dotyczy zamówienia.';

-- ---------------------------------------------------------------------
-- 2. Kolumna wyliczana „czy jest co pokazywać"
-- ---------------------------------------------------------------------
--
-- Kształt jest wymuszony przez PostgREST: funkcja w schemacie tabeli,
-- JEDEN argument typu wiersza, `stable` — wtedy da się ją wybrać w
-- `select=` jak zwykłą kolumnę. Grantu dla `anon` NIE MA: anon nie widzi
-- ani jednego wiersza tej tabeli, więc funkcja nad wierszem jest dla niego
-- bezprzedmiotowa, a nadany grant byłby mylącym sygnałem w audycie.
--
-- Obcięcie białych znaków nie jest ozdobą: rejestrator, który zapisałby sam
-- odstęp albo samo przejście do nowej linii, dałby przycisk „Podgląd treści"
-- otwierający puste okno — czyli dokładnie to udawanie treści, którego
-- zabrania rozstrzygnięcie 1.
--
-- ZBIÓR ZNAKÓW JEST PODANY JAWNIE, bo `btrim(x)` w jednoargumentowej postaci
-- obcina WYŁĄCZNIE spacje: treść złożona z samych przejść do nowej linii
-- przeszłaby przez taką bramkę jako „jest co pokazywać" (sprawdzone —
-- pierwsza wersja tej funkcji tak właśnie odpowiadała).

create or replace function public.email_log_has_body(public.email_logs)
returns boolean
language sql
stable
set search_path = ''
as $$
  select length(btrim(coalesce($1.body, ''), E' \t\r\n')) > 0
$$;

comment on function public.email_log_has_body(public.email_logs) is
  'Kolumna wyliczana PostgREST-a (ADR-073): czy wpis historii ma zapisaną treść. Pozwala liście wiadomości zamówienia odróżnić „treść niedostępna" (wpisy sprzed 0035) od treści do pokazania BEZ pobierania samej treści.';

revoke all on function public.email_log_has_body(public.email_logs) from public;
grant execute on function public.email_log_has_body(public.email_logs) to authenticated, service_role;
