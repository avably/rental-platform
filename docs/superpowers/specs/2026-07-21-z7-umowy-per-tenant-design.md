# Z7 — umowy per tenant: projekt

## Cel

Z7 domyka przepływ umowy najmu: operator konfiguruje dane prawne wypożyczalni i regulamin, generuje umowę z aktualnych danych zamówienia przez zamrożony interfejs `renderContractPdf(props)`, zachowuje dokładne bajty PDF-a, pobiera je oraz wysyła klientowi jako załącznik. System zostawia trwały, tenantowy ślad wygenerowania i każdej próby wysyłki.

Zakres nie obejmuje podpisu elektronicznego, automatycznej wysyłki przy zmianie statusu, webhooków dostarczenia ani przechowywania stanu `delivered`. W Z7 `sent` znaczy, że Resend przyjął wiadomość.

## Rozstrzygnięte warianty

Wybrany jest trwały prywatny plik wraz z metadanymi. Odrzucono ponowne renderowanie z zapisanego snapshotu propsów, ponieważ zmiana wersji renderera lub fontu mogłaby zmienić bajty. Odrzucono też generowanie wyłącznie na żądanie, ponieważ nie daje dowodu, który egzemplarz otrzymał klient.

Wysyłka używa istniejącego portu e-mail i historii `email_logs`. Nie powstaje równoległy dziennik wiadomości. Nowy rodzaj `rental_contract` wskazuje konkretny dokument, a wynik próby pozostaje `sent` albo `failed`.

Decyzje o prywatnym magazynie, niezmienności dokumentów i idempotencji wysyłki opisze ADR-061. Schemat wprowadzi migracja 0026.

## Konfiguracja umów

Ustawienia są jednym wierszem `tenant_settings` pod kluczem `contract_document`. Wartość ma dokładny kształt:

```ts
interface ContractDocumentSettings {
  address: string;
  nip: string | null;
  email: string;
  terms_version: string;
  terms_body: string;
}
```

Migracja dokłada CHECK dla typu obiektu, dokładnego zestawu kluczy i limitów: adres 1–500 znaków, NIP null albo 1–30 znaków, e-mail 3–320 znaków, wersja 1–100 znaków i treść regulaminu 1–50 000 znaków. Walidacja Zod w panelu jest lustrem, nie jedyną bramką. Obowiązujące owner-only polityki zapisu `tenant_settings` pozostają źródłem autoryzacji; każdy członek może odczytać konfigurację potrzebną do pracy z zamówieniem.

Nowa strona `/ustawienia-umow` pozwala ownerowi edytować ustawienia, a staffowi pokazuje konfigurację bez możliwości zapisu. Nawigacja i copy są dostępne po polsku i angielsku.

## Niezmienny dokument i prywatny Storage

Powstaje prywatny bucket `rental-contracts`. Ścieżka obiektu ma postać `{tenant_id}/{order_id}/{document_id}.pdf`. Polityki `storage.objects` pozwalają uwierzytelnionemu członkowi tenanta wyłącznie wstawić i odczytać plik w jego prefiksie. Zwykła sesja nie dostaje UPDATE ani DELETE, więc wysłanego egzemplarza nie można podmienić ani usunąć.

Tabela `contract_documents` zawiera:

- `id`, `tenant_id`, `order_id` oraz tenantowy złożony FK do zamówienia;
- `storage_path`, zgodny z prefiksem tenanta i identyfikatorem dokumentu;
- `sha256`, 64 małe znaki hex policzone z dokładnych bajtów;
- `locale`, `terms_version`, `recipient` i `created_by` jako metadane audytowe;
- `created_at`.

Tabela jest append-only: członkowie mają SELECT i INSERT, bez UPDATE/DELETE. Unikalność `(tenant_id, order_id, sha256)` sprawia, że ponowne wygenerowanie identycznego dokumentu wykorzystuje istniejący egzemplarz. `storage_path` jest globalnie unikalny.

Generowanie przebiega w kolejności: autorytatywny odczyt danych → złożenie propsów → render → SHA-256 → sprawdzenie istniejącego hasha → upload prywatnego pliku z `upsert: false` → INSERT metadanych. Jeżeli równoległy INSERT wygra wyścig unikalności, akcja usuwa wyłącznie własny świeżo przesłany sierocy obiekt przez wąską funkcję naprawczą i zwraca istniejący dokument. Zwykła ścieżka produktu nadal nie ma dowolnego DELETE.

## Składanie zamrożonych propsów

Panel tworzy `ContractPdfProps` bez zmiany publicznego interfejsu `@avably/pdf`:

- `locale`: `customers.locale ?? tenants.locale`, po sanityzacji do `en | pl`;
- `tenant`: `tenants.name` oraz `contract_document.address/nip/email`;
- `customer`: nazwa, e-mail i złożony adres z pól klienta;
- `order`: numer, daty sformatowane w locale klienta i liczba dni z `rentalDaysInclusive`;
- `items`: nazwa produktu, numer seryjny, kwota najmu i kaucja z utrwalonych pozycji;
- `totals`: utrwalone sumy zamówienia, `delivery_grosze` oraz waluta tenanta;
- `terms`: wersja i treść z konfiguracji umów.

Wołający nie przelicza historycznej ceny i nie odczytuje jej z bieżącego cennika. Brak konfiguracji, klienta, adresu klienta albo pozycji jest jawną odmową generowania z lokalizowanym komunikatem. NIP tenanta pozostaje opcjonalny zgodnie z kontraktem PDF.

## Pobieranie

Route handler pod szczegółem zamówienia przyjmuje identyfikator dokumentu, sprawdza członkostwo przez istniejący guard, czyta metadane przez RLS, pobiera prywatny obiekt tą samą sesją i ponownie liczy SHA-256. Niezgodność hasha daje błąd integralności zamiast wydania zmienionego pliku. Odpowiedź ma `Content-Type: application/pdf`, bezpieczną nazwę z numerem zamówienia oraz `Cache-Control: private, no-store`.

## Wysyłka i idempotencja

Umowa jest wysyłana jako załącznik dokładnie z prywatnego obiektu, nigdy przez ponowne renderowanie. Wiadomość używa nazwy tenanta w polu From, konfiguracji `email_sender` dla Reply-To i prostego tekstu EN/PL informującego o załączonej umowie. Nie powstaje nowa zależność ani osobny system szablonów; szablon trafia do `@avably/emails` i zachowuje wariant 8a.

`OutgoingEmail` dostaje opcjonalne `idempotencyKey`. Transport Resend przenosi je do nagłówka `Idempotency-Key`; brak klucza pozostawia payload i zachowanie wszystkich istniejących wysyłek bez zmian.

Każde wyrenderowanie formularza wysyłki niesie UUID próby. Klucz dostawcy ma stabilną postać `rental-contract/{document_id}/{attempt_id}`. `email_logs` dostaje `contract_document_id` i `idempotency_key`; dla `rental_contract` oba są wymagane, dla innych rodzajów pozostają null. Unikalność `(tenant_id, idempotency_key)` oraz odczyt istniejącego wpisu przed wysłaniem chronią także po 24-godzinnym oknie Resend. Powtórne wysłanie tego samego formularza zwraca zapisany wynik; świadome „Wyślij ponownie” po przeładowaniu tworzy nowy identyfikator próby.

Wysyłka zachowuje wzorzec uczciwej częściowej porażki: dokument pozostaje wygenerowany, a błąd transportu tworzy wpis `failed`. Błąd samego zapisu dziennika nie może przebrać udanej wysyłki w nieudaną, ale jest pokazany operatorowi zgodnie z istniejącym `sendAndLog`.

## Interfejs operatora

Na szczególe zamówienia powstaje sekcja „Umowa”:

- informacja o brakującej konfiguracji i link do `/ustawienia-umow`;
- akcja „Wygeneruj umowę”;
- przy każdym dokumencie: czas, wersja regulaminu, język, skrócony hash i „Pobierz”;
- akcja „Wyślij klientowi” oraz świadome „Wyślij ponownie”;
- wynik ostatnich prób `wysłano / błąd` z czasem i czytelnym powodem.

Sekcja używa istniejących komponentów i tokenów Avably, nie zmienia struktury pozostałych sekcji zamówienia. Z7 nie uruchamia dev-servera równolegle z innymi sesjami; odbiór UI może zostać wykonany po zwolnieniu środowiska.

## Bezpieczeństwo i prywatność

- Bucket jest prywatny; brak anonimowego SELECT.
- RLS tabeli i Storage wiąże każdy odczyt/zapis z `app.tenant_id()`.
- Złożony FK uniemożliwia wskazanie zamówienia innego tenanta.
- Route download nie ufa samemu `document_id`; czyta rekord tenantową sesją.
- HTML regulaminu przechodzi wyłącznie do renderera PDF, a nie jest renderowany jako HTML panelu.
- Dziennik przechowuje metadane i odbiorcę zgodnie z istniejącą polityką `email_logs`; nie duplikuje treści PDF.
- Dokument zawiera dane osobowe i podlega późniejszej polityce retencji fazy 5. Automatyczne kasowanie pozostaje poza Z7, ponieważ append-only jest wymaganiem dowodowym tego etapu.

## Obsługa błędów

- Niepełne ustawienia lub dane zamówienia: brak generowania i lokalizowany błąd pola/sekcji.
- Błąd renderera: brak uploadu i rekordu dokumentu.
- Błąd uploadu: brak rekordu dokumentu.
- Błąd INSERT po uploadzie: kontrolowane sprzątnięcie własnego obiektu; przy konflikcie hasha zwrot istniejącego dokumentu.
- Brak obiektu lub niezgodny hash przy pobieraniu/wysyłce: twarda odmowa integralności.
- Brak transportu albo nadawcy: dokument istnieje, wysyłka nie startuje, operator widzi powód.
- Odrzucenie przez Resend: wpis `failed`, dokument bez zmian.

## Testy i dowody

Testy jednostkowe przypinają parser ustawień, składanie propsów, daty EN/PL, brak ponownej wyceny, hash bajtów, wiadomość z załącznikiem i klucz idempotencji. Test transportu dowodzi obecności nagłówka wyłącznie dla wiadomości z kluczem.

Testy integracyjne na lokalnym Supabase przypinają:

- izolację SELECT/INSERT `contract_documents` i prywatnych obiektów Storage;
- brak UPDATE/DELETE zwykłą sesją;
- FK międzytenantowy;
- CHECK konfiguracji i metadanych;
- powiązanie `email_logs` z dokumentem tego samego tenanta;
- wymaganie i unikalność klucza idempotencji dla `rental_contract`;
- brak regresji istniejących rodzajów e-maili.

Test ścieżki panelu generuje realny PDF, parsuje go przez `unpdf`, porównuje SHA-256 z metadanymi, pobiera identyczne bajty oraz wysyła je przez wstrzyknięty transport. EN i PL zachowują istniejące asercje treści `@avably/pdf` bez zmiany kontraktu.

Obowiązkowe mutacje:

1. osłabienie tenantowego warunku Storage — czerwony test cross-tenant;
2. pominięcie ponownej kontroli SHA-256 przy pobraniu — czerwony test integralności;
3. usunięcie `Idempotency-Key` z transportu — czerwony test nagłówka i podwójnej próby;
4. złożenie sumy z bieżącego cennika zamiast utrwalonych kwot — czerwony test propsów;
5. zmiana bajtów załącznika względem zapisanego PDF-a — czerwony test tożsamości hash/załącznik.
6. pobranie `document_id` należącego do innego tenanta — czerwony test dowodzi odmowy przez RLS na metadanych i Storage, niezależnie od guarda route handlera.

Pełna weryfikacja obejmuje testy pakietów, typecheck, lint, build, lokalny reset Supabase, testy RLS oraz oba joby CI. Commit ma autora `Avably <admin@avably.io>`. PR Z7 jest zależny kolejno od PR #90 (paleta PDF) i PR #91 (P7 w `apps/panel`). PM wykonuje rebase na oba poprzedniki i ponawia CI przy odbiorze; autor Z7 nie rebasuje gałęzi w locie. Ponieważ Z7 wnosi migrację 0026 oraz nowe polityki Storage i RLS, merge wymaga jawnej zgody właściciela po odbiorze PM.
