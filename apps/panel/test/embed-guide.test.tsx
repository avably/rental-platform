// @vitest-environment jsdom
/**
 * Kontrakt karty osadzenia na ekranie /ustawienia-api (M3, ADR-120).
 *
 * Bramka pilnuje rzeczy, których nie widać w code review, a które przy embedzie
 * są sednem: fragment podany najemcy nie może nieść sekretu ani identyfikatora
 * najemcy w atrybucie, bo pierwsze idzie do cudzego HTML-u, a drugie byłoby
 * kanałem podmiany na cudzej stronie.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";

import plMessages from "../messages/pl.json";
import enMessages from "../messages/en.json";
import { EmbedGuide } from "../app/[locale]/(panel)/ustawienia-api/embed-guide";
import { embedPreviewUrlForSlug, embedSnippetForSlug } from "../lib/embed/snippet";

afterEach(cleanup);

const SNIPPET = embedSnippetForSlug("acme");

function renderGuide(locale: "pl" | "en" = "pl") {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "pl" ? plMessages : enMessages}>
      <EmbedGuide snippet={SNIPPET} previewUrl={embedPreviewUrlForSlug("acme")} />
    </NextIntlClientProvider>,
  );
}

describe("fragment osadzenia — kształt kontraktu", () => {
  it("niesie najemcę WYŁĄCZNIE w hoście adresu skryptu", () => {
    expect(SNIPPET).toContain("https://acme.");
    expect(SNIPPET).toContain("/embed/loader");
    // Gdyby najemca był atrybutem, strona gospodarza mogłaby go podmienić.
    expect(SNIPPET).not.toContain("data-avably-tenant");
    expect(SNIPPET).not.toContain("tenant");
  });

  it("nie zawiera ŻADNEGO sekretu — to jest warunek wklejenia go w cudzy HTML", () => {
    expect(SNIPPET).not.toMatch(/avbl_/);
    expect(SNIPPET.toLowerCase()).not.toContain("key");
    expect(SNIPPET.toLowerCase()).not.toContain("token");
    expect(SNIPPET.toLowerCase()).not.toContain("secret");
  });

  it("nie wskazuje na publiczne API maszynowe (tamto jest za kluczem)", () => {
    expect(SNIPPET).not.toContain("/api/v1");
  });

  it("opcje są wyłącznie prezentacyjne", () => {
    const full = embedSnippetForSlug("acme", {
      productId: "11111111-1111-4111-8111-111111111111",
      lang: "en",
      theme: "dark",
    });

    expect(full).toContain('data-avably-product="11111111-1111-4111-8111-111111111111"');
    expect(full).toContain('data-avably-lang="en"');
    expect(full).toContain('data-avably-theme="dark"');
    expect(full).not.toMatch(/avbl_/);
  });
});

describe("karta osadzenia — ekran /ustawienia-api", () => {
  it("pokazuje fragment gotowy do skopiowania razem z przyciskiem", () => {
    renderGuide();

    const snippet = document.querySelector("[data-embed-snippet]");
    expect(snippet?.textContent).toBe(SNIPPET);
    expect(document.querySelector("[data-copy-embed-snippet]")).not.toBeNull();
  });

  it("fragment zostaje zaznaczalny — schowek bywa niedostępny na http", () => {
    renderGuide();

    expect(document.querySelector("[data-embed-snippet]")?.className).toContain("select-all");
  });

  it("daje wejście w podgląd tego samego widoku, który zobaczy klient", () => {
    renderGuide();

    const preview = document.querySelector("[data-embed-preview]");
    expect(preview?.getAttribute("href")).toBe("https://acme.avably.io/embed/widget");
    expect(preview?.getAttribute("rel")).toContain("noreferrer");
  });

  it("mówi wprost, że fragment nie zawiera sekretu (to jest pytanie operatora)", () => {
    renderGuide();

    expect(screen.getByText(plMessages.apiSettings.embed.safetyBody)).toBeTruthy();
  });

  it("renderuje się w obu językach — komplet kluczy po obu stronach", () => {
    renderGuide("pl");
    expect(screen.getByText(plMessages.apiSettings.embed.title)).toBeTruthy();
    cleanup();

    renderGuide("en");
    expect(screen.getByText(enMessages.apiSettings.embed.title)).toBeTruthy();
  });

  it("bez adresu podglądu karta nadal działa (fragment jest samowystarczalny)", () => {
    render(
      <NextIntlClientProvider locale="pl" messages={plMessages}>
        <EmbedGuide snippet={SNIPPET} previewUrl={null} />
      </NextIntlClientProvider>,
    );

    expect(document.querySelector("[data-embed-snippet]")).not.toBeNull();
    expect(document.querySelector("[data-embed-preview]")).toBeNull();
  });
});
