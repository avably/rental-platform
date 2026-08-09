# Standard dokumentacji i współpracy — Avably

Ten dokument jest wiążący dla KAŻDEGO, kto pracuje w tym repo (człowiek, Claude,
GPT/Codex, dowolny agent LLM). Bez spełnienia jego wymagań zadanie nie jest
ukończone i PR nie wchodzi.

## 1. Dokumentacja jako warunek zamknięcia (Definition of Done)

Żywa dokumentacja to `docs/dokumentacja/index.html` — samowystarczalny,
przeglądalny plik HTML. Jest źródłem prawdy o architekturze i musi wystarczyć,
by dowolny człowiek lub LLM wszedł, zrozumiał system i kontynuował pracę bez
dostępu do historii rozmów.

Master-indeks to `docs/dokumentacja/hub.html` — pojedynczy punkt wejścia:
linki do dokumentacji, planu, galerii design systemu, mapa kodu, opis
Superpowers/stacku, prompt startowy dla nowej sesji LLM oraz rosnąca lista
materiałów. **Każdy nowy, nietymczasowy materiał** (nowy artefakt HTML,
dashboard, konto usługi, dokument, board) dopisujemy do sekcji „Materiały"
lub „Dokumenty" w hub.html — inaczej zniknie z pola widzenia.

**Każdy PR MUSI zaktualizować dokumentację w tym samym PR co kod:**

1. **Sekcja modułu** którego dotyczy zmiana — cel, publiczny interfejs
   (eksportowane funkcje/typy z sygnaturami), zależności, kluczowe pliki.
2. **Dziennik budowy** (build log) — nowy wpis na górze: data, numer zadania,
   numer PR, jednozdaniowo co powstało i co to odblokowuje.
3. **Model danych** — przy każdej migracji: tabele, kolumny, polityki RLS.
4. **Dziennik decyzji** — przy każdej nietrywialnej decyzji architektonicznej:
   kontekst, decyzja, konsekwencje.

Zasada: **nie ma wpisu w dokumentacji → zadanie nieukończone.** Recenzent
odrzuca PR bez aktualizacji docs.

## 2. Podział pracy na pasy (lanes) — własność wyłączna

Każdy katalog ma JEDNEGO właściciela. Nie edytuj plików spoza swojego pasa.

| Obszar | Właściciel | Zakres |
|---|---|---|
| `packages/db` (schemat, migracje, RLS, klienci) | **Claude** | sekwencyjne, security-krytyczne |
| `packages/core` (silnik wynajmu, wyceny, dostępność) | **Claude** | logika domenowa |
| `apps/panel` — auth, superadmin, API/route handlers, backend | **Claude** | |
| `.github/workflows` (CI) | **Claude** | jedno źródło prawdy |
| `packages/ui` (design system: tokeny, komponenty, galeria) | **GPT** | prezentacja |
| `packages/emails` (szablony e-mail) | **GPT** | |
| `packages/pdf` (generator umów) | **GPT** | |
| `apps/storefront` — powłoka, marketing/LP, UI publiczne | **GPT** | |
| `apps/panel` — ekrany UI konsumujące `@avably/ui` | **GPT** | tylko warstwa widoku |

Sekcje dokumentacji dziedziczą własność pasa: każdy edytuje tylko sekcje modułów
ze swojego pasa (minimalizacja konfliktów w jednym pliku HTML).

## 3. Zasady twarde (zero kolizji)

1. **Nie edytuj pakietu spoza swojego pasa.** Potrzebujesz zmiany u sąsiada →
   wpis w pliku postępu drugiej strony NIE, tylko: opisz potrzebę w PR/uwadze,
   druga strona to wykona. Nigdy nie wchodź w cudzy kod.
2. **Migracje DB i pliki CI tworzy WYŁĄCZNIE Claude.** GPT, gdy potrzebuje
   zmiany schematu, opisuje ją (tabela, kolumny, polityki) i czeka na migrację.
3. **Gałąź per zadanie**, PR do `main`, **nigdy push bezpośrednio na main.**
   Nazwy: `feat/...`, `fix/...`, `docs/...`.
4. **Rebase przed startem i przed PR.** `git pull origin main` na starcie,
   rebase na main przed otwarciem PR.
5. **Zależności** dodawaj do `package.json` SWOJEGO pakietu, nie do roota.
   Konflikt `pnpm-lock.yaml` po merge rozwiązujesz przez `pnpm install`.
6. **Osobne pliki postępu** (zero kolizji): Claude → `.superpowers/sdd/progress.md`,
   GPT → `.superpowers/gpt/progress.md`. Katalog `.superpowers/` jest gitignore.
7. **Kontrakt między pasami** = typy eksportowane z `@avably/db` (Claude) i
   komponenty z `@avably/ui` (GPT). Zmiana kontraktu = wpis w dokumentacji +
   uzgodnienie w PR, zanim druga strona na nim polega.

## 4. Zasady jakości i stylu (całe repo)

- Autor commitów: **`Avably <admin@avably.io>`** (polityka od 2026-07-16; nie
  nazwisko). ZERO stopek `Co-Authored-By` / „Generated with" / wzmianek o AI
  w commitach, kodzie, dokumentacji.
- ZERO nazw konkurencyjnych produktów w kodzie/komentarzach/docs.
- Język produktu i dokumentacji: **polski**. Waluta PLN (grosze jako int).
  Strefa Europe/Warsaw.
- TypeScript strict; Zod na każdym wejściu API; testy per pakiet (Vitest).
- Definition of Done fazy: testy zielone, testy izolacji RLS zielone,
  dokumentacja zaktualizowana, zero sekretów w kliencie.

## 5. Środowisko

- Monorepo pnpm + Turborepo. Node 20. `pnpm install` w roocie.
- Lokalny Supabase (standard dev): CLI w `~/.local/share/supabase`, stack
  startowany z `packages/db` (`supabase start`), analityka wyłączona w
  `config.toml`. GPT w swoim pasie (ui/emails/pdf/storefront-shell) zwykle
  nie potrzebuje bazy.
- CI: joby `ci` (typecheck/lint/test/audit) i `rls` (izolacja RLS na
  efemerycznym Supabase) muszą być zielone przed merge.
- Branch protection: włączona dopiero w fazie 4 (GitHub Pro). Do tego czasu
  obowiązuje dyscyplina PR + zielone CI.

## Merge a deploy na Vercelu (plan Hobby) — pułapka autorstwa

Projekty Vercela należą do konta **avably**, a plan Hobby **nie wspiera
współpracy przy repozytoriach prywatnych**. Skutek: deploy PRODUKCYJNY jest
blokowany, gdy autorem commita na `main` jest ktokolwiek inny niż właściciel
projektu — komunikat brzmi „The deployment was blocked because the commit
author did not have contributing access to the project on Vercel".

`gh pr merge --squash` przypisuje commit scalający **kontu, którym mergujesz**.
Merge wykonany innym kontem (np. `starkit-rental`) daje commit, którego Vercel
nie wpuszcza — PR jest zmergowany, CI zielone, a **produkcja po cichu zostaje
na starym buildzie**. Podglądy z gałęzi (Preview) działają dalej, więc brak
deployu łatwo przeoczyć.

**Zasada:** merge do `main` wykonuje konto właściciela projektu Vercela
(`gh auth switch --user avably` przed merge), albo właściciel klika merge
w interfejsie GitHuba. Po merge sprawdź, że deployment PRODUKCYJNY faktycznie
wystartował — sam zielony CI tego nie dowodzi.
