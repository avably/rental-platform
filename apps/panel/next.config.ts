import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  transpilePackages: ["@avably/core", "@avably/db",
    "@avably/review", "@avably/security", "@avably/ui"],
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
  experimental: {
    /**
     * Górna granica ciała żądania akcji serwerowych. Domyślna to 1 MB —
     * i była tu MILCZĄCĄ NIEPRAWDĄ, zanim ta linia powstała.
     *
     * Panel obiecuje operatorowi dwa limity na plikach: „Zdjęcie może mieć
     * najwyżej 5 MB" (lib/catalog-validation.ts) i — od D3/ADR-076 —
     * „Faktura może mieć najwyżej 8 MB". Obu tych zdań nie dawało się
     * spełnić: żądanie powyżej 1 MB odbijało się o framework, zanim
     * jakakolwiek nasza walidacja je zobaczyła, a operator dostawał błąd
     * 413 bez powodu zamiast zdania, które przeczytał w interfejsie.
     * Limit ogłoszony i limit egzekwowany muszą być tym samym limitem —
     * inaczej odmowa nie jest uczciwa, tylko przypadkowa.
     *
     * 12 MB, a nie 8: to budżet CAŁEGO żądania (obwiednie multipart, pola
     * formularza, narzut kodowania), więc musi być wyraźnie WYŻSZY od
     * największego dopuszczalnego pliku. Wtedy odmową zawsze rusza NASZA
     * bramka, z powodem — a limit frameworka zostaje ostatnią siatką, do
     * której poprawne użycie nie dociera.
     *
     * DRUGIEGO SUFITU TU NIE PODNOSIMY i to jest decyzja. Ciało żądania
     * przechodzi jeszcze przez klon dla warstwy pośredniczącej
     * (`middlewareClientMaxBodySize`, domyślnie 10 MB); powyżej niego
     * `proxy.ts` dostaje ciało OBCIĘTE i akcja kończy się błędem 500
     * „Unexpected end of form". Zamiast rozsuwać oba limity, limit pliku
     * (8 MB) stoi pod tym niższym — mniej globalnych pokręteł i mniej
     * miejsc, w których trzeba pamiętać o obu naraz.
     *
     * ŚWIADOMY KOSZT: ustawienie jest globalne, więc dotyczy także akcji
     * przed zalogowaniem (logowanie, rejestracja, reset hasła) — anonim może
     * wysłać 12 MB zamiast 1 MB. Tamte ścieżki stoją za limitowaniem tempa
     * (@avably/security) i Turnstile, a żadna z nich nie parsuje ciała,
     * zanim odrzuci żądanie, więc kosztem jest przepustowość, nie pamięć.
     */
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default withNextIntl(nextConfig);
