# LP: narracja dnia pracy i aktualne screeny — plan wdrożenia

> **Dla wykonawcy:** użyj procedury `executing-plans`, wykonuj kroki po kolei i zatrzymaj się przed merge'em.

**Cel:** przepisać treść marketingową PL/EN wokół jednego procesu wynajmu oraz podmienić dziewięć starych ujęć produktu na aktualne, bez zmiany designu strony.

**Architektura:** szablon HTML i istniejące klasy pozostają źródłem układu. Treść nadal wchodzi z `messages/{pl,en}.json`, a stabilne tokeny `marketing.shots` wskazują nowe WebP. Aktualność narracji i assetów pilnują małe testy kontraktowe, nie nowy runtime.

**Stos:** Next.js, TypeScript, Vitest, statyczny szablon marketingowy, WebP.

---

## Zadanie 1: czerwony kontrakt narracji

**Pliki:**
- Add: `apps/storefront/test/marketing-story-contract.test.ts`
- Read: `apps/storefront/messages/pl.json`
- Read: `apps/storefront/messages/en.json`

1. Dodaj test, który wymaga wspólnej osi procesu w hero, zakładkach i CTA.
2. Dodaj odmowę dawnych opisów pulpitu: „Złoci klienci” / `Golden customers` i osobna lista „Wymaga uwagi” / `Needs attention`.
3. Wymuś parytet kształtu PL/EN i długości najważniejszych bloków w rozsądnych granicach.
4. Uruchom tylko nowy test i potwierdź czerwień z powodu starego copy.

## Zadanie 2: czerwony kontrakt screenów

**Pliki:**
- Add: `apps/storefront/test/marketing-screens-contract.test.ts`
- Read: `apps/storefront/marketing/home.html`
- Read: `apps/storefront/public/produkt/{pl,en}/*.webp`

1. Zapisz manifest dziewięciu ujęć, ich oczekiwane proporcje i minimalne wymiary.
2. Wymuś osobne pliki PL/EN, WebP, poprawne alt-y i brak dawnych sum kontrolnych.
3. Sprawdź, że HTML zachowuje obecne miejsca, klasy ramek i leniwe ładowanie.
4. Uruchom test i potwierdź czerwień na sumach lub wymiarach starych assetów.

## Zadanie 3: nowe copy PL/EN

**Pliki:**
- Modify: `apps/storefront/messages/pl.json`
- Modify: `apps/storefront/messages/en.json`

1. Przepisz hero, punkt wyjścia, zakładki, zakres, pulpit, start, closing i footer według specyfikacji.
2. Skróć bezpieczeństwo i FAQ tylko tam, gdzie powtarzają narrację; zachowaj fakty prawne i cenowe.
3. Wersję EN napisz naturalnie, bez kalki składniowej.
4. Uruchom kontrakt narracji oraz istniejące testy parytetu cennika/triala; doprowadź do zieleni.

## Zadanie 4: wygenerowanie aktualnych ujęć produktu

**Pliki:**
- Temporary, do usunięcia: lokalny harness danych demonstracyjnych / seed
- Replace: `apps/storefront/public/produkt/pl/*.webp`
- Replace: `apps/storefront/public/produkt/en/*.webp`

1. Uruchom aktualny kod panelu i storefrontu na lokalnych, fikcyjnych danych demonstracyjnych.
2. Zrób pełne, czytelne ujęcia dziewięciu ekranów w PL, a następnie EN.
3. Wykadruj do istniejących proporcji 2:1, 3:2 i 4:3 bez ukrywania nazwy ekranu i głównej czynności.
4. Zapisz WebP w stabilnych ścieżkach; usuń każdy tymczasowy route, seed i dane capture-only z diffu.
5. Uruchom kontrakt screenów i potwierdź zieleń.

## Zadanie 5: minimalna korekta prezentacji obrazów

**Pliki:**
- Modify only if measurements require: `apps/storefront/marketing/home.html`
- Modify only if measurements require: `apps/storefront/public/forerunner/css/avably-marketing.css`

1. Otwórz LP z nowymi screenami bez zmian CSS.
2. Jeśli kadr ucina sens obrazu, zmień wyłącznie parametry `<img>` albo istniejące reguły `zrzut-*`; nie zmieniaj sekcji, siatki, promieni, kolorów ani typografii.
3. Uaktualnij fizyczne `width`/`height` w HTML.
4. Uruchom test szablonu i kontrakt screenów.

## Zadanie 6: dokumentacja repozytorium

**Pliki:**
- Modify: `docs/dokumentacja/index.html`

1. Dopisz rozstrzygnięcie treści i mapę screenów do modułu marketingu.
2. Dodaj kolejny wolny ADR po ponownej kontroli numeracji na aktualnym `origin/main`.
3. Dodaj wpis do dziennika budowy: brak migracji, granice zmian, testy i dowody wizualne.

## Zadanie 7: pełna weryfikacja

1. Uruchom testy storefrontu, typecheck, lint i build na Node 22.
2. Uruchom LP lokalnie na `localhost`, sprawdź PL/EN przy 1440, 768 i 375 px.
3. Sprawdź hero, pięć zakładek, pulpit, trzy karty startu, FAQ i menu mobilne.
4. Potwierdź brak poziomego overflow, błędów konsoli, brakujących assetów i regresji focusu.
5. Zapisz końcowe zrzuty LP PL/EN desktop/mobile jako dowód poza commitem lub w katalogu proof, jeśli konwencja PR tego wymaga.

## Zadanie 8: review i handoff przed merge'em

1. Uruchom procedury `verification-before-completion` i `requesting-code-review`.
2. Popraw uwagi P0–P2 i ponów adekwatne testy.
3. Pobierz aktualny `origin/main`, zrebase'uj gałąź i ponów testy kluczowe.
4. Commituj jako `Avably <admin@avably.io>`, wypchnij gałąź i otwórz draft PR.
5. Sprawdź CI. Nie merguj.
6. Zdaj PM-owi raport: zakres, kluczowe decyzje copy, lista screenów, testy, ryzyka/ograniczenia, commit i URL PR.
