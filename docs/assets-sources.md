# Źródła materiałów wizualnych — rejestr licencji

Każdy plik graficzny i wideo na stronie marketingowej ma tu wiersz: skąd
pochodzi, kto jest autorem, na jakiej licencji leży i czy licencja wymaga
atrybucji. Bez wpisu w tej tabeli materiał nie wchodzi do repo.

> **Zmiana z 2026-08-10 (LP 2.0, ADR-128).** Do tej daty dokument twierdził, że
> „strona marketingowa **nie używa** własnych zdjęć stockowych”, a zasada nr 2
> zakazywała stocku wprost. Decyzją właściciela z 2026-08-10 stock **wchodzi**
> — pod twardym filtrem opisanym w zasadach niżej. Oba zdania były prawdziwe do
> dnia tej decyzji i zostały tu zastąpione, a nie ukryte.

## Szablon strony

| Plik lokalny | Źródło | Autor | Pobrano | Licencja | Atrybucja |
|---|---|---|---|---|---|
| `apps/storefront/public/forerunner/**` (CSS, `webflow.js`, fonty Raveo, obrazy) | szablon Forerunner — eksport HTML kupiony w sklepie autora | studio BYQ | 2026-07-22 | single-site (jeden projekt: `www.avably.io`); wolno self-host, własny backend i modyfikacje na potrzeby tego projektu; NIE wolno redystrybuować, odsprzedawać ani używać jako motywu sklepu najemcy | nie |

## Wideo i fotografia stockowa (LP 2.0)

Wszystko poniżej pochodzi z Pexels. Licencja sprawdzona u źródła
(`pexels.com/license/`, 2026-08-10): użycie komercyjne dozwolone, **atrybucja
nie jest wymagana**, modyfikacje dozwolone; zakazane jest użycie materiału jako
własnego znaku towarowego oraz sugerowanie, że osoby lub marki z kadru popierają
produkt. Strona licencji **nie rozstrzyga** kwestii zgody modela — dlatego
w całym zestawie **nie ma ani jednej osoby**, a ryzyko braku model release
wynosi zero, nie „mało”.

| Plik lokalny | Co widać | Źródło (strona zasobu) | Autor | Licencja | Atrybucja | Waga |
|---|---|---|---|---|---|---|
| `public/marketing/hero-magazyn-720.{av1.mp4,vp9.webm,h264.mp4}` | magazyn części: ściana ponumerowanych regałów z pojemnikami, powolny najazd, zero ludzi | `pexels.com/video/stacks-of-storage-containers-4941466/` | Tima Miroshnichenko | Pexels | nie | 211 / 375 / 369 kB |
| `public/marketing/hero-poster-1600.webp`, `hero-poster-750.webp` | klatka tego samego materiału (t=0,24 s pętli) | jw. (wyprowadzone z pliku wyżej) | Tima Miroshnichenko | Pexels | nie | 45 / 19 kB |
| `public/marketing/kafel-budowlana-560.webp` | betoniarka w remontowanym wnętrzu | `pexels.com/photo/concrete-mixer-in-renovated-building-15798780/` | autor niepodpisany na stronie zasobu (atrybucja niewymagana) | Pexels | nie | 12 kB |
| `public/marketing/kafel-narzedziowa-560.webp` | tablica z kompletem kluczy i imbusów | `pexels.com/photo/organized-wrenches-on-metal-board-in-workshop-30390964/` | jw. | Pexels | nie | 23 kB |
| `public/marketing/kafel-eventowa-560.webp` | spiętrzone identyczne krzesła w magazynie | `pexels.com/photo/green-chairs-in-the-warehouse-12488391/` | jw. | Pexels | nie | 33 kB |
| `public/marketing/kafel-fotovideo-560.webp` | dwa reflektory sceniczne | `pexels.com/photo/close-up-photo-of-a-black-spotlight-13312280/` | jw. | Pexels | nie | 14 kB |
| `public/marketing/kafel-rowerowa-560.webp` | rząd identycznych kół rowerowych | `pexels.com/photo/close-up-of-bicycle-wheels-in-a-neat-row-28556401/` | jw. | Pexels | nie | 19 kB |

**Kadrowanie, które usuwa cudze oznaczenia** (część doboru, nie kosmetyka):

- wideo hero: kadr `1651×929` z lewego górnego rogu ujęcia 1920×1080 zdejmuje
  z prawego dolnego rogu stempel EPAL i niemieckojęzyczną kartę magazynową;
- kafel rowerowy: kadr przesunięty tak, by wyciąć ostry napis na boku opony —
  w kadrze zostają wyłącznie oznaczenia techniczne, żadnego logotypu producenta;
- kafel budowlany: wiadra z lewego rogu odcięte kadrem.

**Materiały obejrzane i odrzucone** (żeby nie wracały): wideo `4292300` (twarz
w profilu przez cały klip), `7019229`/`7019230` (twarz do 13,8 s), `4727768`
(rozpoznawalna tożsamość sieci handlowej + ludzie), `20382217` (logo „Leofoto”
pięć razy), `28772528`/`12616007` (logo „Godox”/„Profoto”), `1130494`
(plakietki producentów i napisy na oponach), `3371267` (obce napisy „EXIT”,
„STOP”), `9395016`/`38030789`/`34672055` (obce marki na opakowaniach i sprzęcie).

**Nieużyte i dlaczego:** Mixkit i Videvo — licencji nie zweryfikowano u źródła,
więc nie wchodzą; Pexels pokrył całość. Unsplash pominięty w całości, żeby nie
otwierać pułapki Unsplash+/Getty Images (płatna licencja wyglądająca w wynikach
identycznie jak darmowa).

## Zasady

1. Żaden materiał zewnętrzny nie wchodzi na strony marketingowe bez wpisu
   w tabeli wyżej (plik, źródło, autor, licencja, wymóg atrybucji).
2. **Stock jest dopuszczony** (decyzja właściciela, 2026-08-10) wyłącznie pod
   trzema warunkami naraz: **zero rozpoznawalnych twarzy** (licencja autorska
   nie jest zgodą modela), **zero widocznych cudzych marek i logotypów**,
   i materiał pokazuje **sprzęt lub miejsce pracy**, nigdy „naszych klientów”.
   Pexels jest pierwszym wyborem (komercyjnie, bez atrybucji). Na Unsplash
   odrzucamy wszystko z odznaką Unsplash+ i wszystko podpisane Getty Images.
3. Każdy plik trzeba **obejrzeć w pełnej rozdzielczości** przed wpisaniem tutaj
   — tytuł na listingu nie jest dowodem. Poprzedni dobór wyłożył się dokładnie
   na tym: „man scanning stocks” miał twarz w kadrze przez cały klip.
4. Wszystko hostujemy u siebie w `public/`. CSP nie przepuści cudzego CDN,
   a odwołanie do niego padłoby po cichu.
5. Loga klientów, opinie i liczby wdrożeń publikujemy wyłącznie wtedy, gdy
   istnieją i mamy na nie zgodę — nigdy jako element układu do wypełnienia.
6. Waga jest częścią licencji na wejście: katalog `public/marketing` ma sufity
   w CI (`apps/storefront/test/marketing-template.test.ts`) — pojedynczy obraz
   ≤ 60 kB, pojedynczy plik wideo ≤ 480 kB, suma obrazów ≤ 175 kB, suma wideo
   ≤ 1000 kB.
