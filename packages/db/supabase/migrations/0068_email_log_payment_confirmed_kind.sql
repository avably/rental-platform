-- 0068_email_log_payment_confirmed_kind.sql
-- ADR-139: mail „płatność zaksięgowana" do klienta końcowego — KROK PO
-- utrwalonym przejściu `payment_status` w `paid`, nigdy jego warunek.
--
-- ---------------------------------------------------------------------
-- PO CO TA MIGRACJA ISTNIEJE (i dlaczego to JEDYNA jej treść)
-- ---------------------------------------------------------------------
--
-- Strona statusu checkoutu w stanie „sprawdzamy" OBIECUJE klientowi maila
-- o zaksięgowaniu płatności (storefront.payment.statusChecking) — obietnica
-- weszła z Z4/Z9 jako świadome odłożenie i od F1 (ADR-137, metody
-- asynchroniczne: BLIK/P24) stan „sprawdzamy" jest rutyną, nie przypadkiem
-- brzegowym. Cała wysyłka mieści się w istniejących mechanizmach: transport
-- i rejestr (`sendAndLog`, ADR-045), nadawca ADR-036 D2, szablony 8a.
--
-- Jedyne, czego nie ma, to POZWOLENIE bazy na nowy rodzaj wiadomości:
-- `email_logs.kind` stoi na CHECK-u z listą ZAMKNIĘTĄ (0021, rozszerzaną
-- w 0026 i 0036), więc pierwszy zapis `kind = 'payment_confirmed'`
-- skończyłby się błędem 23514. Stąd ta migracja — i stąd jej rozmiar.
--
-- ---------------------------------------------------------------------
-- CZEGO TA MIGRACJA CELOWO NIE ROBI
-- ---------------------------------------------------------------------
--
-- 1. NIE DODAJE KOLUMNY `orders.payment_email_sent`. Fakt „potwierdzenie
--    wysłane" jest WYPROWADZANY z rejestru (tenant, zamówienie,
--    kind = 'payment_confirmed', status = 'sent') — dokładnie ten sam
--    argument co przy `invoice` (0036): druga kolumna byłaby drugim źródłem
--    prawdy i rozjechałaby się z pierwszym przy pierwszej awarii UPDATE.
--    Idempotencję wysyłki rozstrzyga i tak co innego: mail idzie WYŁĄCZNIE
--    przy `changed: true` ze wspólnego rdzenia `applySettlement`, a przejście
--    DO `paid` zdarza się raz (bramka reżimu 0027 nie wpuszcza regresu,
--    więc nie ma drugiego „przejścia", które by mail zdublowało).
--
-- 2. NIE RUSZA `email_logs_contract_shape` (0026). `payment_confirmed`
--    wpada w gałąź „kind <> 'rental_contract'" (contract_document_id NULL,
--    idempotency_key NULL) i ma tam zostać: załącznika nie ma, a kluczem
--    idempotencji wysyłki jest samo przejście stanu, nie nagłówek dostawcy.
--
-- ---------------------------------------------------------------------
-- DLACZEGO PEŁNA PODMIANA CHECK-a, A NIE `add constraint` OBOK
-- ---------------------------------------------------------------------
--
-- Postgres nie ma „dopisz wartość do CHECK-a": listę trzeba podać całą.
-- Drugi, osobny CHECK dopuszczający `payment_confirmed` byłby koniunkcją
-- z pierwszym, czyli nie przepuściłby NICZEGO. Podmiana jest więc jedyną
-- poprawną operacją, a `drop constraint if exists` czyni ją odtwarzalną.
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
    'invoice',
    'payment_confirmed'
  ));

comment on column public.email_logs.kind is
  'Rodzaj wiadomości; lista ZAMKNIĘTA CHECK-iem email_logs_kind_check, lustro EMAIL_LOG_KINDS z @avably/core. Od 0036 zawiera „invoice" — DORĘCZENIE faktury wystawionej poza systemem (ADR-076). Od 0068 zawiera „payment_confirmed" (ADR-139) — potwierdzenie zaksięgowania płatności dla klienta końcowego, wysyłane po utrwalonym przejściu payment_status w paid (changed:true ze wspólnego rdzenia applySettlement); wpis „sent" jest jedynym śladem wysyłki — odpowiednika w kolumnie orders nie ma i mieć nie ma.';
