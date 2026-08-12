/**
 * Kontrakt retry transportowego — przebieg w suicie panelu.
 *
 * Retry opakowuje `globalThis.fetch` dla bramki lokalnego Supabase, a job
 * `rls` uruchamia suity panelu i @avably/db na TEJ SAMEJ żywej instancji —
 * więc obie muszą go mieć i obie muszą pilnować tych samych granic. Do
 * 2026-08-12 pilnowały ich dwiema kopiami po ~1000 linii; poprawka w jednej
 * i cisza w drugiej ugryzła nas przy PR #284.
 *
 * Asercje żyją teraz przy implementacji, w pakiecie, który jest właścicielem
 * bramki Supabase. Ten plik uruchamia je pod konfiguracją panelu — łącznie
 * z sekcją sprawdzającą, że `setupFiles` panelu ładuje plik instalujący retry.
 */
import "../../../packages/db/test/helpers/transport-retry-suite";
