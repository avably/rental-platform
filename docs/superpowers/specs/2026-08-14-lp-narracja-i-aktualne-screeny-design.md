# LP: narracja dnia pracy i aktualne screeny — specyfikacja

**Data:** 2026-08-14  
**Zakres:** marketing Avably (`apps/storefront`)  
**Poza zakresem:** redesign, zmiana komponentów produktu, funkcje panelu i sklepu, analityka, dokumenty prawne

## Problem

Obecny landing page ma prawdziwe informacje, ale podaje je jak rozbudowany katalog funkcji. Te same obietnice — dostępność, kaucje, płatności i sklep — wracają w hero, zakładkach, kartach zakresu, CTA, sekcji startowej i FAQ. Czytelnik dostaje dużo detalu przed prostą odpowiedzią: co Avably zmienia w zwykłym dniu wypożyczalni.

Zrzuty produktu pochodzą sprzed ostatniego kierunku wizualnego panelu. Część jest zbyt ciasno wykadrowana, przez co pokazuje tabelę albo fragment formularza bez kontekstu ekranu. Tekst opisuje dziś także pulpit sprzed przebudowy („Wymaga uwagi”, złoci klienci), podczas gdy aktualny pulpit jest widokiem dnia z checklistą startową.

## Rozważone kierunki narracji

### 1. Katalog funkcji

Każda sekcja odpowiada jednej grupie możliwości: rezerwacje, płatności, dokumenty, sklep, integracje. To kierunek łatwy do skanowania, ale utrwala obecne powtórzenia i nie buduje różnicy między zestawem funkcji a działającym procesem wynajmu.

### 2. Problem → napięcie → rozwiązanie

Strona zaczyna od chaosu w kalendarzu, telefonów i nierozliczonych kaucji, a następnie przedstawia Avably jako wyjście. Kierunek jest wyrazisty, lecz zbyt długo zatrzymuje czytelnika przy problemie i może brzmieć jak straszenie właściciela wypożyczalni jego własną pracą.

### 3. Dzień pracy wypożyczalni — wybrany

Strona prowadzi od przygotowania oferty i przyjęcia rezerwacji, przez wydanie lub wysyłkę, po zwrot, kaucję i kontrolę tego, co wymaga działania. Funkcje pozostają dowodami, ale układają się w proces. Ten kierunek najlepiej wykorzystuje istniejące sekcje i pozwala podmienić screeny bez redesignu: każdy obraz pokazuje kolejny etap tej samej historii.

## Zasada główna

**Jedna wypożyczalnia, jeden przepływ, jedno źródło prawdy od rezerwacji do rozliczonego zwrotu.**

Treść mówi językiem rezultatów i codziennych czynności. Szczegóły techniczne zostają wyłącznie tam, gdzie są dowodem lub odpowiedzią na obiekcję. Nie składamy obietnic funkcji, których nie ma, nie podajemy terminów prac i nie używamy nazw konkurentów.

## Architektura treści bez zmiany designu

Istniejące sekcje, kolejność, klasy i rytm wizualny zostają. Zmieniamy ich zadanie komunikacyjne:

1. **Banner:** konkret wejścia — 14 dni, bez karty, bez prowizji Avably i limitu użytkowników.
2. **Hero:** prosta definicja produktu i najważniejszy efekt: rezerwacja wpada do tego samego miejsca, z którego zespół wydaje sprzęt i rozlicza zwrot.
3. **Punkt wyjścia:** różnica między kalendarzem rezerwacji a pełną obsługą najmu.
4. **Branże:** kwalifikacja odbiorcy bez udawania, że każdy biznes działa identycznie.
5. **Zakładki ze screenami:** pięć etapów przepływu, nie pięć przypadkowych funkcji.
6. **Głos założyciela:** krótki, wiarygodny kontekst pochodzenia produktu.
7. **Zakres:** funkcje wspierające proces, których nie trzeba rozwijać w zakładkach.
8. **Pulpit + CTA:** dzisiejsze decyzje i lista spraw do zrobienia, zgodnie z aktualnym produktem.
9. **Start w trzech krokach:** realistyczny onboarding, bez fałszywych obietnic czasu dla całego katalogu.
10. **Bezpieczeństwo:** bez zmian merytorycznych poza skróceniem i ujednoliceniem tonu.
11. **FAQ, cennik, kontakt:** odpowiedzi zgodne z nowym słownictwem i stanem produktu.
12. **Closing/footer:** jeden wyraźny następny krok.

## Mapa screenów

Zachowujemy obecne miejsca i proporcje kontenerów. Podmieniamy obrazy na ujęcia wygenerowane z bieżącego kodu, na jawnie fikcyjnych danych. Każdy screen ma pokazać nazwę ekranu lub kontekst shella, a nie sam wycinek tabeli.

### Zakładki procesu (2:1)

1. **Dzień / dostępność:** aktualny widok tworzenia zamówienia z terminem i dostępnymi egzemplarzami.
2. **Kaucja:** aktualny szczegół rozliczenia kaucji z saldem i historią zdarzeń.
3. **Dostawa:** aktualny ekran przesyłki powiązanej z zamówieniem.
4. **Strona sklepu:** aktualny kreator z płótnem i narzędziami publikacji.
5. **Rezerwacja klienta:** aktualny sklep lub koszyk z terminem i podsumowaniem.

### Pulpit (3:2)

Aktualny pulpit: sekcja „Dzisiaj” lub „Zacznij tutaj”, wraz z najważniejszymi sprawami operacyjnymi. Copy nie może opisywać usuniętych modułów.

### Start (4:3)

1. Aktualne logowanie/rejestracja z brandingiem Avably.
2. Aktualny katalog z pełnym kontekstem nagłówka i nawigacji.
3. Aktualna lista zamówień z filtrami i statusem procesu.

PL i EN dostają osobne ujęcia, jeśli interfejs niesie tekst. Pliki mają zachować stabilne adresy publiczne, żeby nie zmieniać układu HTML ani kontraktu tokenów. Format: WebP, bez danych osobowych, bez prawdziwych danych klientów i integracji.

## Prezentacja obrazów

- Zachowujemy istniejące ramki i proporcje sekcji.
- Wewnątrz ramki screen korzysta z `object-fit: cover`, ale punkt kadrowania dobieramy tak, by tytuł i główna czynność pozostały czytelne.
- Nie dodajemy dekoracyjnych okien przeglądarki, nowych gradientów, kart ani osobnej galerii.
- Atrybuty `width` i `height` odpowiadają realnym wymiarom; wszystkie obrazy poza hero pozostają leniwe.
- Teksty alternatywne opisują zadanie i widoczny stan, nie powtarzają nagłówka sekcji.

## Kontrakty jakości

1. PL i EN mają identyczny kształt kluczy marketingowych.
2. Hero odpowiada w pierwszych dwóch zdaniach: czym jest Avably, dla kogo i co dzieje się po rezerwacji.
3. Pięć zakładek tworzy kolejność procesu i nie powtarza tych samych leadów.
4. Copy pulpitu odpowiada aktualnemu widokowi dnia; nie zawiera „Złotych klientów” ani dawnej sekcji „Wymaga uwagi”.
5. Wszystkie dziewięć screenów istnieje w obu językach, ma bieżące wymiary i nie jest identycznym bajtowo plikiem ze starą wersją.
6. HTML LP zachowuje istniejące sekcje, klasy i kolejność; zmiany prezentacji screenów mogą dotyczyć wyłącznie ich ramek i parametrów obrazów.
7. Widoki 1440, 768 i 375 px nie mają poziomego przepełnienia; tekst nie nachodzi na obrazy.
8. Cennik, trial, płatności i zakres funkcji pozostają zgodne z kodem i istniejącymi testami parytetu.

## Weryfikacja

- Test kontraktu narracji i zakazanych, nieaktualnych sformułowań.
- Test manifestu screenów, wymiarów i parytetu PL/EN.
- Istniejące testy szablonu, nawigacji, cen i triala.
- Typecheck, lint i produkcyjny build storefrontu.
- Przegląd PL/EN na desktopie, tablecie i telefonie, łącznie z rozwinięciem zakładek i menu.
- Porównanie screenów strony po zmianie; brak redesignu potwierdzamy przez niezmienioną strukturę sekcji i klasy szablonu.

