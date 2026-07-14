-- 0002_hardening.sql
-- Utwardzenie funkcji bramkujących RLS (finding z recenzji Task 4):
-- app.tenant_id() i app.is_superadmin() są SECURITY DEFINER-owalne w
-- przyszłości i już teraz stanowią jedyne źródło prawdy o tenancie/roli
-- superadmina dla wszystkich polityk RLS — bez przypiętego search_path
-- sesja mogłaby podstawić własne obiekty pod nazwy nieskwalifikowane
-- (funkcje/operatory) i wpłynąć na wynik. Ciała obu funkcji odwołują się
-- wyłącznie do wbudowanych operatorów/funkcji (pg_catalog) i jawnie
-- kwalifikowanego auth.jwt() — przypięcie search_path do pg_catalog jest
-- więc bezpieczne i nie zmienia zachowania.

alter function app.tenant_id() set search_path = pg_catalog;
alter function app.is_superadmin() set search_path = pg_catalog;
