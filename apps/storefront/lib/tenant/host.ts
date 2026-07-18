/**
 * Klasyfikacja hosta żądania → gałąź routingu storefrontu (Zadanie 2.1,
 * ADR-039). Funkcja CZYSTA: bierze surowy nagłówek Host, nie dotyka sieci ani
 * bazy. Rozstrzygnięcie slug→tenant_id (z odpytaniem bazy) jest osobne
 * (lib/tenant/resolve.ts) — tu decydujemy tylko, KTÓRA ścieżka.
 *
 * Cztery wyniki:
 *   - `marketing` — kanon (www/apex avably.io), dev (localhost, 127.0.0.1),
 *     preview (*.vercel.app). Ta gałąź to ISTNIEJĄCA ścieżka LP, bez zmian.
 *   - `tenant { slug }` — `<slug>.avably.io` (prod) lub `<slug>.localhost` (dev)
 *     z poprawnym, niezarezerwowanym slugiem. Wymaga rozwiązania w bazie.
 *   - `not-found` — subdomena tenant-roota o SLUGU NIEPOPRAWNYM (nie przejdzie
 *     CHECK-u bazy) albo wielopoziomowa. 404 bez odpytania bazy — malformed
 *     slug nigdy nie jest tenantem, więc nie ma po co ruszać Postgresa.
 *   - `foreign { host }` — host spoza naszych domen (WŁASNA domena najemcy albo
 *     obcy host wskazany na nasz deployment). Wymaga rozwiązania w bazie PO
 *     HOŚCIE (Zadanie 2.6, ADR-046).
 *
 * ZMIANA W 2.6 WZGLĘDEM ADR-039 (decyzja 3). Do 2.1 host spoza `*.avably.io`
 * wpadał WPROST w `marketing`, bo własne domeny najemców nie istniały. Teraz
 * dostaje własny wynik: wołający próbuje rozwiązać go przez
 * `app.resolve_tenant_by_domain`, a przy BRAKU trafienia wraca do
 * DOTYCHCZASOWEGO zachowania (marketing). Semantyka kanonu, dev i preview jest
 * nietknięta — te hosty nadal klasyfikują się jako `marketing` i nigdy nie
 * ruszają bazy.
 *
 * Neutralne 404 z ADR-039 zostaje bez zmian: chroni przed ujawnieniem istnienia
 * tenanta na osi `*.avably.io`, gdzie nieistniejący i zawieszony slug dają
 * identyczną odpowiedź. Obcy host nierozwiązany nadal nie jest 404 — pokazanie
 * 404 zamiast LP niczego by nie ochroniło, a zepsułoby hosty operacyjne.
 */
import { ROOT_DOMAIN, RESERVED_SUBDOMAINS } from "@avably/core";

export type HostClassification =
  | { kind: "marketing" }
  | { kind: "tenant"; slug: string }
  | { kind: "not-found" }
  | { kind: "foreign"; host: string };

/**
 * Hosty PLATFORMY spoza wzorca subdomeny tenanta, które nigdy nie są własną
 * domeną najemcy: pętla zwrotna i preview deploymentów. Wyliczone JAWNIE, bo
 * od 2.6 „wszystko inne" idzie do rozwiązania po domenie — gdyby preview
 * (`*.vercel.app`) wpadał tam razem z resztą, każde żądanie na deployment
 * podglądowy generowałoby zapytanie do bazy o host, który nigdy nie będzie
 * niczyją domeną.
 */
const LOOPBACK_HOSTS = ["127.0.0.1", "[::1]", "::1", "0.0.0.0"];
const PREVIEW_SUFFIX = ".vercel.app";

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

  // 127.0.0.1 (dev) i *.vercel.app (preview) — hosty platformy, nie tenanta.
  if (LOOPBACK_HOSTS.includes(host) || host.endsWith(PREVIEW_SUFFIX)) {
    return { kind: "marketing" };
  }

  // Każdy inny host: kandydat na WŁASNĄ domenę najemcy (2.6). Rozstrzyga baza;
  // brak trafienia → wołający wraca na gałąź marketingową (zachowanie z 2.1).
  return { kind: "foreign", host };
}
