/**
 * Indeks przeglądu dla właściciela: komplet przeniesionych stron i wariantów
 * w jednym miejscu, żeby dało się je obejrzeć ciągiem i wskazać, który układ
 * zostaje per typ strony. Świadomie POZA szablonem — to narzędzie robocze,
 * nie część produktu, więc nie ładuje jego arkuszy i nie wchodzi do sitemap.
 *
 * ZA HASŁEM (decyzja właściciela, 2026-07-22): natywne HTTP Basic Auth —
 * przeglądarka sama pyta o dane, nazwa użytkownika jest dowolna, liczy się
 * hasło. Route handler zamiast page.tsx, bo strona nie może odpowiedzieć
 * statusem 401 z nagłówkiem WWW-Authenticate — a to on wywołuje natywne
 * okno logowania.
 *
 * ==================== JAK ZDJĄĆ HASŁO ====================
 * Przywrócić stronę jako zwykłą page.tsx: `git log --diff-filter=D --
 * apps/storefront/app/[locale]/przeglad/page.tsx` wskaże commit, który ją
 * usunął; `git checkout <commit>^ -- apps/storefront/app/[locale]/przeglad/page.tsx`
 * przywraca plik. Potem usunąć TEN plik (route.ts nie może istnieć obok
 * page.tsx) i test apps/storefront/test/przeglad-auth.test.ts. Alternatywa
 * bez grzebania w historii: usunąć z tego pliku blok `authorized(...)`
 * wraz z wczesnym `return` w GET — strona zostanie na route handlerze,
 * ale otworzy się bez pytania.
 * =========================================================
 */
import { timingSafeEqual } from "node:crypto";

import { hasLocale } from "next-intl";

import { routing } from "@/i18n/routing";
import { PUBLIC_PAGES, REVIEW_PAGES } from "@/lib/marketing/template";

export const dynamic = "force-dynamic";

/**
 * Hasło przeglądu — celowo STAŁA w kodzie, nie sekret w env: bramka ma
 * odgrodzić narzędzie robocze od przypadkowych oczu, a nie chronić dane.
 * Repo jest prywatne; zmiana hasła to zmiana tej linijki i deploy.
 */
const REVIEW_PASSWORD = "notavably";

/** Basic Auth: liczy się wyłącznie hasło; porównanie w stałym czasie. */
function authorized(header: string | null): boolean {
  if (!header || !header.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
  } catch {
    return false;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;
  const given = Buffer.from(decoded.slice(separator + 1), "utf8");
  const expected = Buffer.from(REVIEW_PASSWORD, "utf8");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const ROUTE_OF: Record<string, string> = { home: "" };

function routeFor(page: string): string {
  return ROUTE_OF[page] ?? page;
}

function reviewIndexHtml(locale: string): string {
  const groups = [
    { title: "Strony publiczne (linkowane, indeksowane)", pages: PUBLIC_PAGES },
    { title: "Warianty do wyboru (noindex, poza nawigacją)", pages: REVIEW_PAGES },
  ];

  const sections = groups
    .map(
      (group) => `
      <section style="margin-top:2.5rem">
        <h2 style="font-size:1rem;text-transform:uppercase;letter-spacing:0.08em">${group.title}</h2>
        <ul style="line-height:2;padding-left:1.25rem">
          ${group.pages
            .map((page) => {
              const route = `/${locale}/${routeFor(page)}`;
              const note = page === "home" ? " — landing" : "";
              return `<li><a href="${route}">${route}</a>${note}</li>`;
            })
            .join("\n          ")}
        </ul>
      </section>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Przegląd układów — Avably</title>
</head>
<body style="margin:0">
<main style="font-family:ui-sans-serif,system-ui,sans-serif;margin:0 auto;max-width:48rem;padding:3rem 1.5rem">
  <h1 style="font-size:1.75rem;letter-spacing:-0.02em">Przegląd układów</h1>
  <p style="color:#55616D;line-height:1.6">Komplet stron przeniesionych z szablonu. Warianty są do wyboru — treść uzupełniamy na tych, które zostaną.</p>
${sections}
  <p style="color:#55616D;margin-top:2.5rem">Ta strona jest narzędziem roboczym: nie ma jej w nawigacji ani w sitemap.</p>
</main>
</body>
</html>`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ locale: string }> },
): Promise<Response> {
  const { locale } = await context.params;
  if (!hasLocale(routing.locales, locale)) {
    return new Response("Not found", { status: 404 });
  }

  if (!authorized(request.headers.get("authorization"))) {
    return new Response("Wymagane hasło przeglądu.", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="przeglad", charset="UTF-8"',
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  }

  return new Response(reviewIndexHtml(locale), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "no-store",
    },
  });
}
