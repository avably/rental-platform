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
 * wpadał WPROST w `marketing`, bo własne domeny najemców nie istniały. Od 2.6
 * dostaje własny wynik `foreign` i wołający próbuje rozwiązać go przez
 * `app.resolve_tenant_by_domain`. Semantyka kanonu, dev i preview jest
 * nietknięta — te hosty nadal klasyfikują się jako `marketing` i nigdy nie
 * ruszają bazy.
 *
 * CO ROBI WOŁAJĄCY Z `foreign` BEZ TRAFIENIA — ZMIANA W ADR-131. Do 2026-08-10
 * wracał na gałąź marketingową, przez co domena zawieszonego albo usuniętego
 * najemcy serwowała jego klientom landing page Avably. Dziś kończy tym samym
 * neutralnym 404 co nieznana subdomena (`apps/storefront/proxy.ts`), więc obie
 * osie hostów mają JEDNĄ odmowę i żadna nie zdradza stanu tenanta.
 *
 * TA FUNKCJA JEST WOBEC TEGO BRAMKĄ HOSTÓW PLATFORMY: co zwróci `marketing`,
 * zobaczy LP. Nowy host operacyjny (druga domena marketingowa, inny host
 * podglądu) trzeba dopisać TUTAJ — pominięcie wpisu daje 404, nie wyciek.
 *
 * Neutralne 404 z ADR-039 zostaje bez zmian tam, gdzie już było: chroni przed
 * ujawnieniem istnienia tenanta na osi `*.avably.io`, gdzie nieistniejący
 * i zawieszony slug dają identyczną odpowiedź.
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
 * Pozostałe domeny NASZEGO portfela wskazane na ten sam deployment
 * (`docs/dokumentacja/hub.html`: `avably.pl`, `avably.app` — marka/redirect).
 * Apex i `www.`, bez subdomen: nie są tenant-rootami i nikt nie dostanie pod
 * nimi sklepu.
 *
 * DLACZEGO DOPISANE DOPIERO PRZY ADR-131. Dopóki nierozwiązany host obcy
 * spadał na marketing, te domeny działały PRZYPADKIEM — przez tę samą dziurę,
 * którą ADR-131 zamyka. Zamknięcie jej bez tego wpisu wygasiłoby je na 404,
 * gdyby którakolwiek była aliasem projektu, a nie redirectem na brzegu. Wpis
 * jest więc zachowaniem stanu istniejącego, nie nową funkcją: jeśli redirect
 * siedzi w DNS/Vercelu, żądanie i tak tu nie dociera i lista jest martwa.
 *
 * To NIE jest furtka dla obcych hostów — wyliczenie jest zamknięte i dotyczy
 * wyłącznie domen, których właścicielem jesteśmy.
 */
const PLATFORM_MARKETING_DOMAINS = ["avably.pl", "avably.app"] as const;

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

  // Pozostałe domeny naszego portfela (apex i www) — patrz docblock listy.
  if (PLATFORM_MARKETING_DOMAINS.some((own) => host === own || host === `www.${own}`)) {
    return { kind: "marketing" };
  }

  // Każdy inny host: kandydat na WŁASNĄ domenę najemcy (2.6). Rozstrzyga baza;
  // brak trafienia → wołający odmawia neutralnym 404 (ADR-131).
  return { kind: "foreign", host };
}
