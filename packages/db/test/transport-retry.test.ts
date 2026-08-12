/**
 * Kontrakt retry transportowego — przebieg w pakiecie @avably/db.
 *
 * Asercje żyją w jednym miejscu (test/helpers/transport-retry-suite.ts) i są
 * rejestrowane przez sam import. Ten plik istnieje po to, żeby vitest tego
 * pakietu je zebrał — razem z sekcją pilnującą, że `setupFiles` TEGO pakietu
 * naprawdę ładuje plik instalujący retry.
 */
import "./helpers/transport-retry-suite";
