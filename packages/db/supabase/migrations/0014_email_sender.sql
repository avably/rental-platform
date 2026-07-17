-- Migracja 0014 — nadawca e-maili cyklu najmu.
--
-- Kontekst: ADR-033 (wysyłka e-maili cyklu najmu z panelu: wspólny adres
-- platformy, transport wstrzykiwany, jawna niedostępność).
--
-- Zawartość:
--   1. walidacja klucza tenant_settings.email_sender (CHECK wartości
--      wzorcem tenant_settings_order_number_prefix_valid z 0007 i kluczy
--      kurierskich z 0013).
--
-- ŚWIADOMIE BEZ POLA `address`: adres nadawcy NIE jest daną tenanta. Pole
-- From składa się ze stałej platformy (RESEND_FROM_EMAIL, fallback
-- DEFAULT_FROM_EMAIL) i nazwy tenanta — adres per najemca wymagałby
-- weryfikacji DNS jego domeny, kosztu nieproporcjonalnego do fazy 1.
-- Gdyby adres dało się tu zapisać, wyglądałby na działający, a wysyłka
-- i tak szłaby z domeny platformy — pole-atrapa jest gorsze niż jego brak.
-- Tenant personalizuje nazwę wyświetlaną i opcjonalny reply_to, na który
-- klient realnie odpowiada.
--
-- KONWENCJE UTRZYMANE (patrz docs/konwencje-migracji.md i nagłówki 0007/0011/0013):
--   * walidacja U ŹRÓDŁA, przy zapisie ustawienia — a nie dopiero przy
--     wysyłce, błędem, którego PostgREST nie umie pokazać,
--   * CHECK pilnuje KSZTAŁTU (obiekt, wymagane pola, typy); semantykę
--     adresu (czy skrzynka istnieje) weryfikuje dostawca przy wysyłce,
--   * wyłącznie standardowe SQLSTATE (23514) — kody P0xxx PostgREST zjada
--     do gołego 500 bez treści (nagłówek 0011).
--
-- NUMERACJA: 0012 pozostaje świadomie wolne (kolejność stosowania jest
-- leksykalna, luka jest legalna — patrz nagłówek 0013).

-- ---------------------------------------------------------------------
-- 1. Walidacja klucza tenant_settings.email_sender (ADR-033)
-- ---------------------------------------------------------------------
--
-- Koniunkcja owinięta w coalesce(..., false): przy BRAKU klucza w obiekcie
-- `value->'pole'` to SQL NULL, jsonb_typeof(NULL) to NULL, NULL propaguje
-- się przez koniunkcję — a CHECK z wynikiem NULL PRZECHODZI (trójwartościowa
-- logika SQL, pułapka opisana w 0011). Bez coalesce nadawca BEZ nazwy
-- przechodziłby bramkę, mimo że nazwa z błędnym typem już nie — złapane
-- testem email-sender.
--
-- reply_to jest opcjonalny, więc bramkuje go `not (value ? 'reply_to') or ...`:
-- brak klucza jest legalny, obecny klucz musi mieć poprawny typ i długość.
alter table public.tenant_settings
  add constraint tenant_settings_email_sender_valid check (
    key <> 'email_sender' or coalesce((
      jsonb_typeof(value) = 'object'
      and jsonb_typeof(value->'name') = 'string'
      and length(btrim(value->>'name')) between 1 and 120
      and (not (value ? 'reply_to') or (
        jsonb_typeof(value->'reply_to') = 'string'
        and length(value->>'reply_to') between 3 and 320
      ))
    ), false)
  );

comment on constraint tenant_settings_email_sender_valid on public.tenant_settings is
  'Kształt tenant_settings.email_sender: {name text 1..120 po btrim, reply_to? text 3..320} (ADR-033). Adres nadawcy jest stałą platformy (RESEND_FROM_EMAIL), nie daną tenanta — tenant personalizuje wyłącznie nazwę w polu From i adres odpowiedzi.';
