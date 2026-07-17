/**
 * Klasyfikacja hosta żądania → gałąź routingu storefrontu (Zadanie 2.1,
 * ADR-039). Funkcja CZYSTA: bierze surowy nagłówek Host, nie dotyka sieci ani
 * bazy. Rozstrzygnięcie slug→tenant_id (z odpytaniem bazy) jest osobne
 * (lib/tenant/resolve.ts) — tu decydujemy tylko, KTÓRA ścieżka.
 *
 * Trzy wyniki:
 *   - `marketing` — kanon (www/apex avably.io), dev (localhost, 127.0.0.1),
 *     preview (*.vercel.app) oraz każdy host spoza wzorca subdomeny tenanta.
 *     Ta gałąź to ISTNIEJĄCA ścieżka LP, bez zmian.
 *   - `tenant { slug }` — `<slug>.avably.io` (prod) lub `<slug>.localhost` (dev)
 *     z poprawnym, niezarezerwowanym slugiem. Wymaga rozwiązania w bazie.
 *   - `not-found` — subdomena tenant-roota o SLUGU NIEPOPRAWNYM (nie przejdzie
 *     CHECK-u bazy) albo wielopoziomowa. 404 bez odpytania bazy — malformed
 *     slug nigdy nie jest tenantem, więc nie ma po co ruszać Postgresa.
 *
 * DECYZJA (foreign host → marketing, nie 404). Host spoza `*.avably.io`
 * (np. obcy `example.com` skierowany na nasz deployment) trafia do marketingu,
 * nie w 404. Powód: neutralne 404 z briefu chroni przed UJAWNIENIEM istnienia
 * tenanta — a to jest realizowane przez JEDNOLITE 404 na nierozwiązanych
 * subdomenach `*.avably.io` (nieistniejący i zawieszony slug dają identyczną
 * odpowiedź). Obcy host to problem DNS/operacyjny (w produkcji routing domen
 * na Vercelu i tak wpuszcza tylko skonfigurowane domeny), nie wektor
 * ujawnienia tenanta. Trzymanie foreign→marketing nie psuje też dev/preview.
 */
import { ROOT_DOMAIN, RESERVED_SUBDOMAINS } from "@avably/core";

export type HostClassification =
  | { kind: "marketing" }
  | { kind: "tenant"; slug: string }
  | { kind: "not-found" };

/**
 * Lustro CHECK-u `tenants.slug` z 0001_core.sql. Zgodność jest istotna: slug,
 * który tu przejdzie, ma szansę istnieć w bazie; slug, który tu odpada, i tak
 * nie istniałby, więc 404 bez zapytania jest poprawne i tańsze.
 */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,38}$/;

/** Domeny, których pojedyncza subdomena to storefront tenanta. */
const TENANT_ROOT_DOMAINS = [ROOT_DOMAIN, "localhost"] as const;

function stripPort(host: string): string {
  return host.split(":")[0]?.toLowerCase() ?? "";
}

export function classifyHost(rawHost: string | null | undefined): HostClassification {
  const host = stripPort(rawHost ?? "");
  if (host === "") return { kind: "marketing" };

  for (const root of TENANT_ROOT_DOMAINS) {
    if (host === root) return { kind: "marketing" }; // apex/kanon (localhost, avably.io)
    if (!host.endsWith(`.${root}`)) continue;

    const sub = host.slice(0, host.length - root.length - 1);

    // Wielopoziomowa subdomena (a.b.avably.io) nie jest slugiem tenanta.
    if (sub.includes(".")) return { kind: "not-found" };

    // Subdomeny zarezerwowane (www, app, api, …) to platforma, nie tenant —
    // padają w marketing (dla www to kanon; reszta i tak nie trafia tu w prod).
    if (RESERVED_SUBDOMAINS.includes(sub)) return { kind: "marketing" };

    if (SLUG_PATTERN.test(sub)) return { kind: "tenant", slug: sub };

    // Subdomena tenant-roota o niepoprawnym slugu → neutralne 404, bez bazy.
    return { kind: "not-found" };
  }

  // 127.0.0.1 (dev), *.vercel.app (preview) i każdy inny host → marketing.
  return { kind: "marketing" };
}
