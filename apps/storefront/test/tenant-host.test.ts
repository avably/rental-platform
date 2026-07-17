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
    // Obcy host → marketing (decyzja: neutralne 404 chroni subdomeny tenanta,
    // nie obce hosty — patrz docblock host.ts).
    "najemca.example",
    "",
  ])("host marketingowy '%s' → marketing", (host) => {
    expect(classifyHost(host)).toEqual({ kind: "marketing" });
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
