-- 0071_waitlist_backend_off.sql
-- Wyłączenie osieroconego backendu waitlisty: revoke + DROP app.join_waitlist.
--
-- KONTEKST. Decyzja właściciela (2026-08-12, bez ADR): Avably to SaaS
-- z pełną samodzielną rejestracją (trial 14 dni) — lista oczekujących nie
-- wraca. PR #270 zdjął waitlistę z warstwy stron (trasa /waitlist, formularz,
-- klucze i18n) i zostawił backend NIEODLINKOWANY: RPC `app.join_waitlist`
-- (0006, przepisana w 0011 na SQLSTATE 22023) wciąż była wołalna publicznym
-- kluczem anon z przeglądarki, mimo że żaden kod produktu jej nie woła.
-- Nieodlinkowana publiczna ścieżka ZAPISU danych osobowych (e-mail, telefon)
-- to czysta powierzchnia ataku bez żadnej funkcji — znika w całości.
--
-- CO ROBI TA MIGRACJA:
--   1. revoke EXECUTE z anon/authenticated (i pas bezpieczeństwa: PUBLIC),
--      zanim funkcja zniknie — kolejność świadoma: gdyby DROP kiedykolwiek
--      wypadł z pliku przy edycji, samo revoke już zamyka ścieżkę publiczną
--      (fail-closed), a nie odwrotnie.
--   2. DROP FUNCTION app.join_waitlist — bez `if exists`: migracja ma prawo
--      założyć stan po 0011; gdyby funkcji nie było, chcemy głośnego błędu,
--      nie cichego no-opa na rozjechanym środowisku.
--
-- CZEGO TA MIGRACJA ŚWIADOMIE NIE ROBI:
--   * Tabela `public.waitlist_signups` ZOSTAJE wraz z danymi — to historyczne
--     zapisy osób, które wyraziły zgodę; retencja wg polityki prywatności.
--     DROP tabeli (albo eksport + czystka) to osobna decyzja właściciela,
--     NIE ta migracja. RLS i granty tabeli bez zmian: anon bez jakiegokolwiek
--     grantu, authenticated sam SELECT za polityką superadmin_select (0006,
--     zaostrzoną w 0060), service_role select+insert. Po DROP-ie RPC tabela
--     nie ma już ŻADNEJ publicznej ścieżki zapisu.
--   * `app.check_rate_limit` (0052) NIE jest ruszana: waitlista była tylko
--     jednym z konsumentów. Sprawdzone u źródła (2026-08-12): licznik woła
--     @avably/security/rate-limit, a przez niego rejestracja/logowanie/reset
--     panelu (apps/panel/app/[locale]/(auth)/*), zaproszenia, checkout,
--     formularz kontaktowy i API v1 storefrontu (lib/api/*). Wpis
--     `check_rate_limit` w allowliście anon (function-acls.test.ts) zostaje.
--
-- Lustro w testach (ten sam PR):
--   * packages/db/test/function-acls.test.ts — wpis `join_waitlist` zdjęty
--     z allowlisty anon (bramka "wpisy martwe" wymusiła spójność w obie
--     strony: wpis bez grantu też by płonął).
--   * packages/db/test/waitlist-decommission.test.ts — introspekcyjny dowód
--     NIEOBECNOŚCI funkcji (z przynętą wzorcem ADR-134) + odmowa PostgREST
--     na wywołanie anon-em + dowód, że tabela przeżyła z włączonym RLS.
--   * deposit-gates/rls-isolation — testy wołające RPC zdjęte; testy izolacji
--     samej tabeli zostają (tabela żyje, więc ma czego bronić).

-- ---------------------------------------------------------------------
-- 1. Revoke — zamknięcie ścieżki publicznej przed usunięciem funkcji
-- ---------------------------------------------------------------------

revoke all on function app.join_waitlist(
  text, text, text, text, boolean, text, boolean, text, text, text, text
) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. DROP — funkcja znika z powierzchni PostgREST w całości
-- ---------------------------------------------------------------------
--
-- Sygnatura pełna (11 argumentów) — dokładnie ta z 0006/0011. Wywołanie
-- anon-em po tej migracji kończy się PGRST202 (brak funkcji w schema cache),
-- czyli odmową na poziomie nieistnienia, nie uprawnień.

drop function app.join_waitlist(
  text, text, text, text, boolean, text, boolean, text, text, text, text
);
