export * from "./types";
export { createBrowserClient, createServerClient } from "./client";
export type { CookieMethodsServer } from "./client";
// createServiceClient celowo NIE jest tu re-eksportowany — dostępny tylko
// przez osobny entrypoint `@rental/db/service` (patrz src/service.ts).
