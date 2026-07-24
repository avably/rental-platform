-- 0036_email_log_invoice_kind.sql
-- ADR-076: panel DORĘCZA fakturę wystawioną poza systemem — nie wystawia jej.
--
-- ---------------------------------------------------------------------
-- PO CO TA MIGRACJA ISTNIEJE (i dlaczego to JEDYNA jej treść)
-- ---------------------------------------------------------------------
--
-- Operator dostaje fakturę od swojej księgowości jako gotowy PDF i chce
-- wysłać ją klientowi z panelu, zamiast przeklejać adres do własnej poczty.
-- Cała ta funkcja mieści się w istniejących mechanizmach: transport umie
-- załączniki (ADR-043, etykieta zwrotna i umowa już ich używają), a ślad
-- wysyłki wraz z TREŚCIĄ zapisuje `sendAndLog` (ADR-045, ADR-073).
--
-- Jedyne, czego nie ma, to POZWOLENIE bazy na nowy rodzaj wiadomości:
-- `email_logs.kind` stoi na CHECK-u z listą ZAMKNIĘTĄ (0021, rozszerzoną
-- w 0026 o `rental_contract`), więc pierwszy zapis `kind = 'invoice'`
-- skończyłby się błędem 23514. Stąd ta migracja — i stąd jej rozmiar.
--
-- ---------------------------------------------------------------------
-- CZEGO TA MIGRACJA CELOWO NIE ROBI
-- ---------------------------------------------------------------------
--
-- 1. NIE DODAJE KOLUMNY `orders.invoice_sent`. Stan „faktura wysłana" jest
--    WYPROWADZANY z tego rejestru: istnieje wpis (tenant, zamówienie,
--    kind = 'invoice', status = 'sent'). Kolumna byłaby DRUGIM źródłem
--    prawdy o tym samym fakcie i — jak każde drugie źródło — rozjechałaby
--    się z pierwszym przy pierwszej wysyłce, która wyszła, ale której
--    UPDATE nie doszedł. Rejestr jest append-only i powstaje w tej samej
--    ścieżce co żądanie do dostawcy, więc jest bliżej zdarzenia niż
--    jakakolwiek flaga zapisywana po fakcie.
--
-- 2. NIE RUSZA `email_logs_contract_shape` (0026). Ten CHECK wymaga
--    `contract_document_id` i `idempotency_key` NULL dla każdego rodzaju
--    INNEGO niż `rental_contract` — `invoice` wpada w tę właśnie gałąź
--    i ma tam zostać. Dokumentu w bazie nie ma (patrz punkt 3), a klucz
--    idempotencji nie miałby czego chronić: operator wybiera plik i moment
--    ręcznie, więc druga wysyłka jest DECYZJĄ, a nie zdublowanym żądaniem.
--
-- 3. NIE TWORZY BUCKETU NA FAKTURY. Wysłany PDF nie jest archiwizowany —
--    archiwum dokumentów finansowych to osobna decyzja (polityki izolacji
--    obiektów, retencja, dostęp), a faktura żyje w księgowości właściciela.
--    Rejestr mówi, że wysłaliśmy, do kogo i co było w treści maila; nie
--    udaje archiwum faktur i ekran mówi to wprost.
--
-- ---------------------------------------------------------------------
-- DLACZEGO PEŁNA PODMIANA CHECK-a, A NIE `add constraint` OBOK
-- ---------------------------------------------------------------------
--
-- Postgres nie ma „dopisz wartość do CHECK-a": listę trzeba podać całą.
-- Drugi, osobny CHECK dopuszczający `invoice` byłby koniunkcją z pierwszym,
-- czyli nie przepuściłby NICZEGO. Podmiana jest więc jedyną poprawną
-- operacją, a `drop constraint if exists` czyni ją odtwarzalną na bazie,
-- na której 0026 już stoi, i na świeżej.
--
-- Lista jest wypisana JAWNIE i w tej samej kolejności co `EMAIL_LOG_KINDS`
-- w `packages/core/src/email/log.ts` — rozjazd tych dwóch miejsc kończy się
-- błędem 23514 przy zapisie, a nie cichym pominięciem wpisu, więc czyta się
-- je razem.

alter table public.email_logs
  drop constraint if exists email_logs_kind_check;

alter table public.email_logs
  add constraint email_logs_kind_check check (kind in (
    'rental_confirmed',
    'rental_ready_for_pickup',
    'rental_picked_up',
    'rental_returned',
    'rental_cancelled',
    'invitation',
    'return_label',
    'pickup_return_reminder',
    'checkout_confirmation',
    'new_order_notification',
    'rental_contract',
    'invoice'
  ));

comment on column public.email_logs.kind is
  'Rodzaj wiadomości; lista ZAMKNIĘTA CHECK-iem email_logs_kind_check, lustro EMAIL_LOG_KINDS z @avably/core. Od 0036 zawiera „invoice" — DORĘCZENIE faktury wystawionej poza systemem (ADR-076): panel wysyła plik wskazany przez operatora jako załącznik i zostawia ślad, ale faktury NIE WYSTAWIA i wysłanego PDF-a NIE ARCHIWIZUJE. Wpis „invoice" ze statusem „sent" jest JEDYNYM źródłem stanu „faktura wysłana" — odpowiednika w kolumnie orders nie ma i mieć nie ma.';
