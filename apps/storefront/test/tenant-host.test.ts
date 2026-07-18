/**
 * Klasyfikacja hosta (lib/tenant/host.ts, Zadanie 2.1). Czysta funkcja —
 * granica między marketingiem, tenantem i neutralnym 404 bez dotykania sieci.
 */
import { describe, expect, it } from "vitest";

import { classifyHost } from "@/lib/tenant/host";

describe("classifyHost — rozgałęzienie po hoście", () => {
  it.each([
    "www.avably.io",
    "avably.io",
    "localhost",
    "localhost:3025",
    "127.0.0.1",
    "127.0.0.1:3025",
    "avably-preview.vercel.app",
    "",
  ])("host marketingowy '%s' → marketing", (host) => {
    expect(classifyHost(host)).toEqual({ kind: "marketing" });
  });

  // ZMIANA 2.6 (ADR-046). Do 2.1 obcy host wpadał WPROST w `marketing`; teraz
  // dostaje własny wynik, bo może być WŁASNĄ domeną najemcy — rozstrzyga baza
  // (app.resolve_tenant_by_domain), a przy braku trafienia wołający wraca na
  // gałąź marketingową. Lista wyżej jest drugą połową tej samej bramki: kanon,
  // dev i preview NIE MOGĄ wpaść do rozwiązywania po domenie, bo wtedy każde
  // żądanie na deployment podglądowy generowałoby zapytanie do bazy.
  it.each([
    ["najemca.example", "najemca.example"],
    ["wypozyczalnia.pl", "wypozyczalnia.pl"],
    ["sklep.NAJEMCA.example", "sklep.najemca.example"], // host case-insensitive
    ["sklep.najemca.example:3035", "sklep.najemca.example"], // port odcięty
  ])("obcy host '%s' → foreign {host: %s} (kandydat na własną domenę)", (host, expected) => {
    expect(classifyHost(host)).toEqual({ kind: "foreign", host: expected });
  });

  it.each([
    ["acme.avably.io", "acme"],
    ["acme.localhost", "acme"],
    ["acme.localhost:3025", "acme"],
    ["ACME.AVABLY.IO", "acme"], // host case-insensitive
    ["sklep-1.avably.io", "sklep-1"],
  ])("subdomena tenanta '%s' → tenant {slug: %s}", (host, slug) => {
    expect(classifyHost(host)).toEqual({ kind: "tenant", slug });
  });

  it.each([
    "www.avably.io", // www jest zarezerwowany → marketing, nie tenant
    "app.avably.io", // panel (zarezerwowany) → marketing
    "api.avably.io",
  ])("subdomena zarezerwowana '%s' → marketing (nie tenant)", (host) => {
    expect(classifyHost(host)).toEqual({ kind: "marketing" });
  });

  it.each([
    "bad_slug.avably.io", // podkreślenie — poza CHECK-iem slugu
    "-lead.avably.io", // slug nie może zaczynać się od myślnika
    "ab.avably.io", // za krótki (min 3 znaki)
    "a.b.avably.io", // wielopoziomowa subdomena
  ])("subdomena o niepoprawnym slugu '%s' → not-found (404 bez bazy)", (host) => {
    expect(classifyHost(host)).toEqual({ kind: "not-found" });
  });
});
