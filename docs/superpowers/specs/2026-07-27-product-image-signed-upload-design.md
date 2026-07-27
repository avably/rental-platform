# Zdjęcia produktów — bezpośredni, podpisany upload: projekt

## Cel

Zmiana przenosi bajty zdjęcia produktu z globalnej akcji serwerowej Next.js
bezpośrednio z przeglądarki do Supabase Storage. Operator nadal wykonuje jedną
czynność: wybiera zdjęcie i klika „Dodaj”. System sam uzyskuje jednorazowy
bilet, wysyła plik i finalizuje metadane.

Efekt bezpieczeństwa tego etapu:

- aplikacja nie przyjmuje już do 5 MB bajtów zdjęcia w `FormData`;
- tenant, produkt, ścieżka, typ i rozmiar są sprawdzane na kilku niezależnych
  granicach;
- przerwany upload nie tworzy widocznego zdjęcia i jest sprzątany;
- ponowne użycie tego samego biletu nie tworzy drugiego wiersza.

## Granica zakresu

Ten projekt obejmuje wyłącznie zdjęcia produktów:

- publiczny bucket `product-images`;
- ekran `/katalog/[id]/zdjecia`;
- tabelę `product_images`;
- nowy, krótkotrwały rejestr uploadów zdjęć;
- sprzątanie przerwanych uploadów zdjęć.

Poza zakresem pozostają faktury PDF, ich wysyłka, prywatny magazyn faktur
i kod zamówienia. `serverActions.bodySizeLimit: "12mb"` pozostaje bez zmian,
ponieważ aktualna wysyłka faktury nadal go potrzebuje. Faktury dostaną osobny
projekt i osobny PR. Globalny limit można obniżyć dopiero po przeniesieniu obu
niezależnych przepływów.

## Stan obecny

`uploadImageAction` odbiera cały `File` przez Server Action, sprawdza deklarowany
MIME i limit 5 MB, przesyła obiekt do `product-images`, a następnie dodaje wiersz
`product_images`. Przy błędzie INSERT próbuje skasować obiekt.

Bucket jest publiczny, ponieważ zdjęcia są treścią publicznego storefrontu.
Polityki `storage.objects` ograniczają zapis do pierwszego segmentu ścieżki
równego `app.tenant_id()`. Bucket nie ma jednak własnego limitu 5 MB ani
allowlisty MIME. Limit jest dziś egzekwowany dopiero przez aplikację.

Globalne `serverActions.bodySizeLimit: "12mb"` powstało, aby framework nie
odrzucał obiecywanego limitu zdjęcia 5 MB i faktury 8 MB przed walidacją
produktu. Ten projekt usuwa z Server Actions pierwszy z tych dwóch plików.

## Rozpatrzone warianty

### Wybrany: bilet serwerowy, signed upload i finalizacja

Serwer autoryzuje zamiar, wybiera losową ścieżkę i tworzy podpisany token do
jednego obiektu. Przeglądarka wysyła bajty bezpośrednio do Storage, a mała akcja
serwerowa finalizuje metadane. To zachowuje autorytatywną decyzję po stronie
serwera, nie przenosi dużego ciała przez Vercel i pozwala odróżnić obiekt
przesłany od zdjęcia przyjętego do katalogu.

### Odrzucony: zwykły upload sesją przeglądarki

Istniejące RLS ograniczyłoby zapis do własnego tenanta, ale przeglądarka sama
wybierałaby ścieżkę przed sprawdzeniem produktu przez serwer. Rozwiązanie jest
krótsze, lecz ma szerszy kontrakt i słabszy ślad jednorazowej autoryzacji.

### Odrzucony: własny endpoint strumieniujący

Endpoint nadal przenosiłby cały plik przez Vercel. Zmieniłby rodzaj handlera,
ale nie usunąłby obciążenia i limitów pośredniej warstwy aplikacji.

Decyzje o bilecie, finalizacji, konfiguracji bucketu i sprzątaniu opisze
ADR-078. Schemat wprowadzi migracja `0038`.

## Migracja 0038

### Rejestr zamiarów uploadu

Powstaje tabela `public.product_image_uploads` z polami:

- `id uuid primary key default gen_random_uuid()`;
- `tenant_id uuid not null`;
- `product_id uuid not null`;
- `requested_by uuid not null`;
- `storage_path text not null unique`;
- `declared_mime text not null`;
- `declared_size bigint not null`;
- `status text not null default 'pending'`;
- `expires_at timestamptz not null`;
- `created_at timestamptz not null default now()`;
- `finished_at timestamptz null`.

Dozwolone statusy to `pending`, `processing`, `completed` i `rejected`.
`declared_size` musi mieścić się w zakresie 1–5 MiB, a `declared_mime`
w allowliście JPEG, PNG, WebP i AVIF. Złożony FK
`(tenant_id, product_id) → products(tenant_id, id)` uniemożliwia utworzenie
biletu dla produktu innego tenanta. `requested_by` wskazuje `auth.users(id)`.

Ścieżka ma dokładny kształt:

`{tenant_id}/{product_id}/{upload_id}.{rozszerzenie-z-MIME}`

CHECK wiąże pierwsze dwa segmenty i identyfikator pliku z kolumnami wiersza.
Rozszerzenie wybiera serwer z allowlisty; nazwa lokalnego pliku nie trafia do
ścieżki Storage.

Tabela ma RLS, jawne REVOKE dla `anon` i `authenticated` oraz nie jest
bezpośrednim API aplikacji. Sesja użytkownika korzysta wyłącznie z wąskich
funkcji `app.*`. `service_role` ma dostęp potrzebny tylko zadaniu sprzątającemu.
Tabela trafia do automatycznej macierzy RLS wraz z fabryką i mutacjami harnessu.

### Wąskie funkcje

Migracja tworzy trzy RPC i jedną wewnętrzną bramkę Storage jako
`SECURITY DEFINER` z zamrożonym `search_path`, jawnymi grantami i bez grantu
dla `anon`:

1. `app.issue_product_image_upload(product_id, declared_mime, declared_size)`
   sprawdza `auth.uid()`, `app.tenant_id()`, istnienie produktu w tym tenancie
   i allowlisty. Tworzy `pending` ważny 15 minut oraz zwraca wyłącznie
   `upload_id` i `storage_path`.
2. `app.claim_product_image_upload(upload_id)` atomowo zmienia własny,
   niewykorzystany i niewygasły bilet `pending → processing`. Zwraca jego
   autorytatywne metadane dokładnie jednemu wywołaniu. Następna próba dostaje
   jedną nierozróżnialną odmowę.
3. `app.finish_product_image_upload(upload_id, outcome)` pozwala temu samemu
   użytkownikowi zakończyć wyłącznie własny `processing` jako `completed` albo
   `rejected`.
4. `app.can_upload_product_image(storage_path)` zwraca prawdę wyłącznie dla
   dokładnego, niewygasłego biletu `pending` bieżącego użytkownika i tenanta,
   którego produkt nadal należy do tego tenanta. Funkcja jest przeznaczona dla
   polityki INSERT Storage i nie daje użytkownikowi dostępu do tabeli biletów.

RPC nie przyjmują `tenant_id`, ścieżki ani `requested_by` od wołającego.
Te wartości wynikają z sesji i wiersza. Tekst odmowy nie rozróżnia cudzego,
nieistniejącego, wygasłego i wykorzystanego biletu. Inny użytkownik tego
samego tenanta również nie może podpisać, przejąć ani domknąć cudzego biletu.

### Tabela docelowa

`product_images.storage_path` dostaje unikalność. Druga finalizacja tego samego
obiektu nie może utworzyć duplikatu nawet przy regresji warstwy aplikacji.
Nowy CHECK wymaga ścieżki o kształcie
`{tenant_id}/{product_id}/{uuid}.{jpg|png|webp|avif}`. Przed dodaniem CHECK-a
migracja jawnie sprawdza zgodność istniejących danych i zatrzymuje się, jeśli
znajdzie stary wiersz poza kontraktem; nie poprawia produkcyjnych ścieżek
automatycznie.

## Konfiguracja i polityki Storage

Bucket `product-images` pozostaje publiczny. Migracja ustawia na nim:

- `file_size_limit = 5 * 1024 * 1024`;
- `allowed_mime_types = image/jpeg, image/png, image/webp, image/avif`;
- `public = true`.

Bucket jest więc niezależną bramką limitu i deklarowanego MIME. Odczyt
storefrontu pozostaje publiczny. Polityka INSERT wymaga sesji `authenticated`
oraz dokładnego, niewygasłego biletu `pending`, dla którego `storage_path`
równa się nazwie obiektu, `tenant_id = app.tenant_id()`, `requested_by =
auth.uid()`, a produkt należy do tego tenanta. Sam poprawny kształt ścieżki nie
wystarcza. Polityka UPDATE nie istnieje, więc po weryfikacji nie można podmienić
bajtów obiektu. Tenant-bound DELETE pozostaje dostępny dla usuwania zdjęć i
kompensacji. Podpisany token powstaje tą samą sesją członka, nigdy z
`service_role`, i ma `upsert: false`.

Token signed uploadu jest sekretem krótkiego życia: nie trafia do bazy, logów,
analityki ani komunikatu błędu. Token Supabase może technicznie działać dłużej
niż bilet aplikacji; po 15 minutach finalizacja odmawia, a zadanie sprzątające
usuwa ewentualny obiekt.

## Przepływ operatora

`UploadImageForm` pozostaje jednym formularzem, ale jego submit jest
koordynowany po stronie klienta:

1. Przeglądarka sprawdza obecność, rozmiar i deklarowany MIME, aby szybko
   pokazać błąd. To wygoda, nie granica bezpieczeństwa.
2. Mała akcja `prepareProductImageUpload` wywołuje wąskie RPC, a następnie
   tworzy `createSignedUploadUrl(storage_path, { upsert: false })` sesją
   członka. Zwraca `uploadId`, `path` i token.
3. Przeglądarka używa `createBrowserClient()` z `@avably/db` oraz
   `uploadToSignedUrl(path, token, file)`. Bajty nie przechodzą przez
   Server Action ani Route Handler panelu.
4. Po sukcesie przeglądarka wywołuje małą akcję
   `finalizeProductImageUpload(uploadId)`. Nie przekazuje ponownie pliku,
   tenanta, produktu, ścieżki, MIME ani rozmiaru.
5. Finalizacja atomowo przejmuje bilet, odczytuje autorytatywną ścieżkę,
   sprawdza obiekt i dopisuje `product_images`.
6. Sukces jest pokazany dopiero po istnieniu wiersza metadanych. Widok zostaje
   odświeżony dotychczasowym `revalidatePath`.

W czasie całej sekwencji przycisk jest zablokowany, tekst pokazuje „Wgrywanie…”,
a drugi submit nie rozpoczyna równoległej próby. Zamknięcie lub odświeżenie
strony pozostawia najwyżej `pending` albo osierocony obiekt do sprzątnięcia;
nie tworzy wiersza zdjęcia.

## Finalizacja i prawdziwy typ pliku

Po atomowym `pending → processing` serwer:

1. pobiera metadane Storage dla ścieżki z biletu;
2. porównuje rozmiar i content type z allowlistą, limitem oraz biletem;
3. pobiera obiekt, którego rozmiar jest już ograniczony do 5 MiB;
4. wykrywa format z sygnatury bajtów JPEG, PNG, WebP albo AVIF;
5. wymaga zgodności wykrytego formatu z zadeklarowanym MIME i rozszerzeniem;
6. wyznacza dotychczasowe `max(sort_order) + 1`;
7. wstawia `product_images`;
8. kończy bilet jako `completed`.

Kod nie ufa nazwie lokalnego pliku, rozszerzeniu podanemu przez przeglądarkę
ani samemu nagłówkowi `Content-Type`. SVG pozostaje zabronione. Wykrywanie
sygnatur jest czystą funkcją z testami każdego formatu i danych skróconych.

Jeżeli walidacja albo INSERT nie przejdzie, finalizacja usuwa dokładnie obiekt
z autorytatywnej ścieżki, oznacza bilet jako `rejected` i zwraca lokalizowany
komunikat. Jeżeli wiersz `product_images` już wskazuje ścieżkę, sprzątanie nie
usuwa obiektu. To chroni poprawne zdjęcie przy częściowej porażce kroku
`finish`.

## Sprzątanie przerwanych uploadów

Powstaje małe zadanie panelu uruchamiane cyklicznie. Kod service-role żyje
wyłącznie w dozwolonym `apps/panel/src/jobs/**`; zwykła ścieżka użytkownika
nie importuje i nie używa `service_role`.

Zadanie:

- wybiera wygasłe bilety `pending`, stare `processing` i `rejected`;
- dla każdej ścieżki sprawdza, czy nie wskazuje jej `product_images`;
- usuwa osierocony obiekt przez Storage API, nigdy przez DELETE SQL na
  `storage.objects`;
- usuwa rekordy `completed` po 7 dniach bez usuwania wskazywanego zdjęcia;
- działa porcjami i jest idempotentne.

Chroniony Route Handler przyjmuje wyłącznie autoryzowane wywołanie harmonogramu.
Sekret harmonogramu musi być ustawiony na Vercelu przed merge. Harmonogram
uruchamia sprzątanie raz dziennie, zgodnie z limitem Vercel Hobby.
Niezakończony obiekt staje się kwalifikowany do usunięcia 24 godziny po
`created_at` i znika przy najbliższym udanym przebiegu. Błąd zadania zwraca
nie-2xx i pozostawia rekord do ponowienia;
dokumentacja operacyjna nie obiecuje niemożliwego „najpóźniej po 24 godzinach”,
gdy sam harmonogram jest niedostępny.

## Obsługa błędów

- Błędny plik przed wydaniem biletu: brak wiersza i brak uploadu.
- Nieistniejący lub obcy produkt: jednolita odmowa, brak signed URL.
- Błąd wydania signed URL: bilet wygasa bez obiektu i zostaje posprzątany.
- Błąd uploadu: brak finalizacji; wygasły bilet i ewentualny fragment nie
  tworzą zdjęcia.
- Brak obiektu przy finalizacji: `rejected`, brak `product_images`.
- Niezgodny rozmiar, MIME lub sygnatura: obiekt usunięty, bilet `rejected`.
- Druga finalizacja: odmowa przed odczytem i INSERT.
- Błąd INSERT po poprawnym uploadzie: obiekt usunięty, brak widocznego zdjęcia.
- Błąd oznaczenia `completed` po poprawnym INSERT: wiersz i obiekt pozostają;
  unikalność ścieżki blokuje duplikat, a cleanup widzi referencję i nie usuwa
  pliku.
- Błąd sprzątania: zadanie kończy się czerwono i ponawia bez utraty informacji
  o ścieżce.

Komunikaty operatora są dostępne po polsku i angielsku. Szczegóły polityk,
tokenów, ścieżek i błędów dostawcy nie są ujawniane w UI.

## Testy i dowody

### Testy jednostkowe i komponentowe

- JPEG, PNG, WebP i AVIF są rozpoznawane po sygnaturze.
- Tekst albo plik ze skróconym nagłówkiem, mimo MIME obrazu, jest odrzucany.
- Klient nie rozpoczyna uploadu po lokalnym błędzie rozmiaru lub typu.
- Submit wywołuje kolejno prepare → signed upload → finalize.
- Podwójny klik nie tworzy drugiej sekwencji.
- Błąd każdego etapu daje czytelny stan i nie pokazuje sukcesu.

### Testy integracyjne na lokalnym Supabase

- członek tenanta A wydaje bilet tylko dla produktu A;
- produkt obcego tenanta oraz losowy UUID dają tę samą odmowę;
- `anon` nie wywołuje funkcji i nie zapisuje obiektu;
- tenant B nie zapisuje, nie finalizuje ani nie usuwa ścieżki A;
- prawidłowy signed upload tworzy obiekt pod dokładną ścieżką;
- bucket przyjmuje plik o rozmiarze dokładnie 5 MiB i odrzuca większy;
- bucket odrzuca MIME spoza allowlisty;
- fałszywe bajty z dozwolonym MIME są usuwane przy finalizacji;
- pełny przepływ tworzy jeden wiersz `product_images`, a publiczny storefront
  odczytuje dokładne bajty;
- drugi claim/finalize tego samego biletu jest odrzucony;
- konflikt INSERT i porażka walidacji nie zostawiają osieroconego obiektu;
- cleanup usuwa wyłącznie wygasły, niereferencjonowany obiekt i nie dotyka
  poprawnego zdjęcia ani świeżego uploadu;
- konfiguracja bucketu ma dokładny limit, allowlistę i `public = true`;
- tabela biletów przechodzi automatyczną macierz RLS.

### Obowiązkowe mutacje wykonawcze

1. Usunięcie weryfikacji produktu/tenanta przy wydaniu biletu musi zaczerwienić
   test obcego produktu.
2. Usunięcie warunku `status = 'pending'` z atomowego claim musi zaczerwienić
   test podwójnej finalizacji.
3. Zaufanie samemu MIME i pominięcie sygnatury musi zaczerwienić test fałszywego
   obrazu.
4. Pominięcie kompensacyjnego usunięcia po błędzie INSERT musi zaczerwienić
   test sieroty.
5. Osłabienie limitu albo allowlisty bucketu musi zaczerwienić test konfiguracji
   i realnego uploadu.
6. Usunięcie sprawdzenia referencji w cleanup musi zaczerwienić test ochrony
   poprawnego zdjęcia.
7. Usunięcie związania INSERT z dokładnym biletem musi zaczerwienić test
   własnej ścieżki bez biletu.
8. Przywrócenie polityki UPDATE musi zaczerwienić test niezmienności bajtów.
9. Oczekiwanie `true` od `finish_product_image_upload RETURNS void` musi
   zaczerwienić żywy test adaptera dla odpowiedzi `data = null, error = null`.

PM przy odbiorze wykonuje własną mutację na innym wektorze i potwierdza
niepusty `git diff --stat` przed uruchomieniem testu.

## Weryfikacja i wdrożenie

Weryfikacja wykonawcza obejmuje:

- `supabase db reset` i pełne testy DB z rzeczywistymi zmiennymi lokalnymi;
- pełne testy panelu;
- typecheck, lint i build panelu;
- pełną bramkę monorepo i audyt zależności;
- oba joby GitHub (`ci`, `rls`);
- preview panelu.

Migracja `0038` zamyka dawny szeroki INSERT bez biletu, więc stary panel nie
może po jej zastosowaniu rozpocząć nowego uploadu zdjęcia. Wdrożenie wymaga
krótkiego, skoordynowanego okna: migracja wchodzi bezpośrednio przed wdrożeniem
nowego panelu; nie wolno pozostawić starego panelu działającego z 0038 dłużej
niż trwa kontrolowany deploy. Kolejność produkcyjna:

1. ustawić i potwierdzić sekret harmonogramu sprzątania;
2. zastosować na PROD dokładny blok migracji wycięty z pliku;
3. potwierdzić wpis `0038` w `schema_migrations`;
4. potwierdzić konfigurację bucketu, granty, polityki i MD5 każdej funkcji
   `SECURITY DEFINER` względem lokalnej bazy z migracją zastosowaną z pliku;
5. dopiero potem oznaczyć PR jako gotowy i zmergować;
6. po deployu wgrać kontrolowane zdjęcie produktu demo, potwierdzić miniaturę
   w panelu i exact publiczny odczyt na storefroncie, a następnie je usunąć;
7. potwierdzić wykonanie i zielony wynik zadania sprzątającego.

Po świeżym lokalnym resecie z plików oczekiwane
`md5(pg_get_functiondef(...))` wynosi:

- `app.issue_product_image_upload(uuid,text,bigint)`:
  `64e33b76e377635c0e01b5642a675356`;
- `app.claim_product_image_upload(uuid)`:
  `30050eb86e5d7bccc69e858b7fb30f1f`;
- `app.finish_product_image_upload(uuid,text)`:
  `9685e8e8790bca3df0a233ff453069ec`;
- `app.can_upload_product_image(text)`:
  `51bf320015df0a30b206f914ea3577a1`.

Rozjazd MD5, brak sekretu harmonogramu, brak polityki, zła konfiguracja bucketu
albo niezgodność danych istniejących zatrzymują merge. Migracji nie wykonuje
się ponownie po merge.

## Dokumentacja i kryterium ukończenia

PR aktualizuje ADR-078, mapę modelu, konwencje migracji, build log oraz roadmapę.
Dług globalnego limitu pozostaje częściowo otwarty z jawną adnotacją:
„zdjęcia przeniesione; faktury i obniżenie 12 MB pozostały”.

Zadanie jest ukończone, gdy operator wgrywa prawidłowe zdjęcie jednym
formularzem, storefront pokazuje dokładny obiekt, wszystkie wymienione odmowy
są dowiedzione, przerwany upload jest sprzątany, a żadne bajty zdjęcia nie
przechodzą przez Server Action panelu. Kod faktur i globalny limit 12 MB
pozostają niezmienione.
