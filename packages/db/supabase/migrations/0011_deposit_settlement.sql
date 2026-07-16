-- 0011_deposit_settlement.sql
-- Rozliczanie kaucji w BAZIE (Faza 1, Zadanie 5): strukturalny powód
-- potrącenia oraz niezmiennik salda rejestru deposit_events. Decyzje:
-- ADR-026 (kształt powodu + niezmiennik), ADR-027 (relacja rozliczenia
-- z payment_status — świadomie POZA bazą, w akcji panelu).
--
-- DLACZEGO W BAZIE: 0007 zapowiedział niezmiennik sumy wprost w komentarzu
-- tabeli („egzekwuje Zadanie 5"). Członek tenanta ma przez RLS bezpośredni
-- INSERT do deposit_events (rejestracja zdarzeń to praca lady), więc reguła
-- trzymana wyłącznie w akcji panelu byłaby do ominięcia jednym żądaniem
-- PostgREST — dokładnie ten sam argument, co przy bramkach 0010 (ADR-024/
-- ADR-025). CHECK wierszowy nie wystarcza: niezmiennik jest MIĘDZYWIERSZOWY
-- (suma zwrotów i potrąceń vs suma pobrań), a dwie równoległe transakcje
-- widzą nawzajem niezatwierdzone salda — stąd trigger z advisory lockiem
-- i re-checkiem w transakcji (wzorzec app.generate_order_number z 0007
-- i app.assert_unit_available z 0010).
--
-- ZERO NOWYCH TABEL: kolumna reason_code na deposit_events, CHECK, trigger
-- i spłata długu kodów w join_waitlist. Macierz izolacji RLS, granty
-- (append-only: bez UPDATE/DELETE — 0007) i rejestr fabryk wierszy bez
-- zmian. Bramka obowiązuje KAŻDĄ rolę, także service_role.
--
-- KODY BŁĘDÓW (asertowane w testach, mapowane na komunikaty w panelu):
--   23514 (check_violation) — potrącenie bez kodu powodu / kod spoza listy /
--     'other' bez doprecyzowania / kod przy pobraniu lub zwrocie (CHECK),
--     oraz rozliczenie przekraczające pobraną kaucję (trigger — ograniczenie
--     na wartościach, ta sama klasa co maszyna stanów w ADR-025),
--   22023 (invalid_parameter_value) — walidacje app.join_waitlist po
--     spłacie długu P0012/P0013 (sekcja 3).
-- Wyłącznie klasy mapowane przez PostgREST (22xxx → 400, 23xxx → 409):
-- kody własne P0xxx PostgREST zjada do gołego 500 bez kodu w odpowiedzi
-- (zweryfikowane na żywej bazie przy Zadaniu 4 — nagłówek 0010).

-- ---------------------------------------------------------------------
-- 1. Strukturalny powód potrącenia (decyzja wiążąca nr 4 planu fazy 1)
-- ---------------------------------------------------------------------
--
-- Anty-wzorzec starkita: powód potrącenia jako notatka tekstowa — nie da
-- się po nim raportować ani spierać strukturalnie. Kod powodu jest DANĄ
-- (lista zamknięta CHECK-iem, rozszerzenie = zwykła migracja jak przy
-- każdym zbiorze text+CHECK od 0001), a `reason` zostaje doprecyzowaniem:
-- opcjonalnym dla kodów z listy, wymaganym dla 'other' (wzorzec zależności
-- warunkowych z 0006). Nadmiarowy kod przy pobraniu/zwrocie jest ODRZUCANY,
-- nie zerowany po cichu — cisza ukryłaby błąd wywołującego (0006).

alter table public.deposit_events add column reason_code text;

comment on column public.deposit_events.reason_code is
  'Strukturalny powód potrącenia (ADR-026): damage | late_return | missing_part | cleaning | other. Wymagany dla kind=deducted, zabroniony dla pozostałych zdarzeń; other wymaga doprecyzowania w reason.';

-- Defensywny backfill dla środowisk z danymi sprzed 0011: stary CHECK
-- gwarantował niepusty reason przy każdym deducted, więc para
-- ('other', dotychczasowy reason) jest zawsze legalna wobec nowego CHECK-a.
update public.deposit_events
  set reason_code = 'other'
  where kind = 'deducted' and reason_code is null;

-- Kod zastępuje dawny wymóg tekstu — tekst bez kodu to dokładnie
-- anty-wzorzec, który ta migracja usuwa.
alter table public.deposit_events
  drop constraint deposit_events_deduction_requires_reason;

-- `reason_code is not null` stoi JAWNIE przed testem przynależności do listy:
-- `null in (...)` daje NULL, NULL propaguje się przez koniunkcję, a CHECK
-- z wynikiem NULL PRZECHODZI (trójwartościowa logika SQL) — bez tego strażnika
-- potrącenie bez kodu prześlizgnęłoby się przez bramkę (złapane testem).
alter table public.deposit_events
  add constraint deposit_events_structured_reason check (
    case when kind = 'deducted'
      then reason_code is not null
        and reason_code in ('damage','late_return','missing_part','cleaning','other')
        and (reason_code <> 'other' or (reason is not null and length(btrim(reason)) > 0))
      else reason_code is null
    end
  );
