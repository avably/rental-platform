/**
 * Atrapa `server-only` dla testów panelu (K3, ADR-086) — lustro atrapy ze
 * storefrontu. Pakiet `server-only` rzuca przy imporcie poza serwerem Reacta,
 * a moduły serwerowe (np. klient wyszukiwarki zdjęć) testujemy wprost w Node.
 * Straż zostaje tam, gdzie ma znaczenie — w buildzie Next.js.
 */
export {};
