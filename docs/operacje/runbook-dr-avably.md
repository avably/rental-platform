# Runbook DR — odtwarzanie Avably po awarii

Procedura Disaster Recovery (I5.7): jak odtworzyć system po awarii, krok po kroku.
Dokument jest **wykonalny** — opisuje konkretne czynności w konkretnej kolejności, nie
ogólniki. Nie zastępuje ćwiczenia DR na żywo (to osobne zadanie, gdy backup/PITR gotowe —
patrz sekcja „Test odtworzenia").

> **Zakres.** Trzy scenariusze: (A) utrata całej bazy, (B) uszkodzenie/utrata danych
> JEDNEGO najemcy, (C) utrata sekretów. Dla każdego: co przywrócić najpierw, jak
> zweryfikować spójność i izolację, jak wznowić ruch.

> **Uwaga launch-krytyczna.** Kilka fundamentów DR to **DECYZJE WŁAŚCICIELA** jeszcze
> niepodjęte. Runbook oznacza je jawnie jako **„DO USTALENIA/ZMIERZENIA PO B4"** i **nie
> zgaduje wartości** (RPO/RTO, czy PITR jest włączony, gdzie leżą kopie, gdzie depozyt
> klucza). Bez tych decyzji część procedury pozostaje szkieletem, a realne odtwarzanie
> skryptem per-najemca jest świadomie zablokowane.

---

## 0. Fundamenty owner-pending — DO USTALENIA/ZMIERZENIE PO B4

Te pozycje są **wejściem** do procedur poniżej. Dopóki właściciel ich nie ustali, pola w
scenariuszach oznaczone `⟨DO USTALENIA⟩` pozostają nierozstrzygnięte.

| # | Decyzja / pomiar | Powiązanie | Stan |
|---|---|---|---|
| 1 | **Czy PITR (Point-In-Time Recovery) jest włączony** na produkcyjnym Supabase i z jakim oknem retencji | B4 | ⟨DO USTALENIA⟩ |
| 2 | **Zewnętrzny magazyn nocnych kopii** poza Supabase/Vercel (drugi dostawca / region) — czy istnieje, gdzie, jak często | I5.1 | ⟨DO USTALENIA⟩ |
| 3 | **Depozyt klucza szyfrującego sekrety** (`AVABLY_SECRETS_KEY_V*`) poza bazą i poza Vercelem — gdzie i kto ma dostęp | I5.4 / ADR-052 | ⟨DO USTALENIA⟩ |
| 4 | **Cel RPO** (Recovery Point Objective — ile danych wolno stracić, np. „max 24 h" albo „max 5 min przy PITR") | B4 | ⟨DO ZMIERZENIA⟩ |
| 5 | **Cel RTO** (Recovery Time Objective — w ile czasu system ma wrócić) | B4 | ⟨DO ZMIERZENIA⟩ |
| 6 | **Format eksportu per-najemca** (I5.6, art. 20 RODO / DR) — manifest + pliki danych | I5.6 | w toku (założony kształt w skrypcie) |

> Gdy decyzje zapadną, zapisać wartości w `docs/operacje/` (dziennik decyzji właściciela) i
> **zaktualizować pola `⟨DO USTALENIA⟩` w tym runbooku** — to warunek zamknięcia I5.

---

## 1. Inwentarz zależności — co gdzie żyje

Odtworzenie wymaga świadomości, że stan systemu **nie mieści się w jednym miejscu**.
Rozłożony jest na dostawców (stack: OVH, Cloudflare, Vercel, Supabase, Stripe, Fakturownia,
Resend — regiony EU).

| Warstwa | Dostawca | Co trzyma | Jak odtworzyć |
|---|---|---|---|
| **Schemat bazy** | repo (`packages/db/supabase/migrations/*`) | źródło prawdy o strukturze — tabele, RLS, funkcje, granty | `supabase db push` / kolejne migracje na czysty projekt |
| **Dane** | Supabase (Postgres) | wiersze wszystkich tabel | restore z nocnej kopii / PITR (scenariusz A) lub eksport per-najemca (B) |
| **Pliki** | Supabase Storage | obrazy produktów, obrazy stron, załączniki | osobny restore bucketów (poza kopią Postgresa — sprawdzić objęcie backupem) |
| **Sekrety najemców** | Postgres `tenant_secrets` (zaszyfrowane) + **klucz w env** | hasła kurierów, tokeny integracji | dane z bazy **+** klucz `AVABLY_SECRETS_KEY_V*` z depozytu (scenariusz C) |
| **Konfiguracja env** | Vercel (per projekt) | wszystkie zmienne runtime/build | ze spisu `docs/operacje/spis-env-avably.md` + `.env.example` |
| **Konta użytkowników** | Supabase Auth (GoTrue, schemat `auth`) | logowanie właścicieli najemców | objęte kopią bazy; `members` mają FK do `auth.users` |
| **Domeny sklepów** | Vercel (rejestracja) + Cloudflare/OVH (DNS) | podpięcie domen najemców | ponowna rejestracja przez panel (`AVABLY_VERCEL_API_TOKEN`) + DNS |
| **Płatności** | Stripe (konto platformy + Connect najemców) | konta Connect, subskrypcje | referencje w bazie; konta żyją u Stripe (nie odtwarzamy ich danych) |
| **Faktury** | Fakturownia | dokumenty księgowe | poza zakresem DR bazy — osobny system dostawcy |
| **Maile** | Resend | transport (bez trwałego stanu po naszej stronie) | tylko klucz API (`RESEND_API_KEY`) ze spisu env |
| **Deploy aplikacji** | Vercel | panel + storefront | redeploy z repo (kod = git) |

**Spis zmiennych środowiskowych:** `docs/operacje/spis-env-avably.md` (artefakt DR, ADR-252) —
kompletny rejestr NAZW (bez wartości). Wartości żyją w Vercelu; przy odtwarzaniu środowiska
uzupełnić je z bezpiecznego źródła właściciela.

> **⚠ Luka w spisie env do domknięcia (do koordynacji PM).** Spis env (ADR-252) **nie
> wymienia** produkcyjnych zmiennych `AVABLY_SECRETS_KEY_CURRENT` i `AVABLY_SECRETS_KEY_V1..N`.
> Są one czytane w produkcji (`resolveSecretsKeyring(process.env)` w
> `apps/panel/.../ustawienia-dostaw/delivery-settings-actions.ts`) i **bez nich sekrety
> najemców są nieodwracalnie nieczytelne** (scenariusz C). Do dopisania do spisu env w jego
> pasie — patrz owner-pending #3 (depozyt klucza).

---

## 2. Scenariusz A — utrata całej bazy

**Objaw:** produkcyjny Postgres niedostępny / uszkodzony / skasowany. Cały tenant-set stracony.

**Cel:** przywrócić spójny stan bazy i wznowić ruch, tracąc nie więcej danych niż RPO
(`⟨DO ZMIERZENIA⟩`) w czasie nie dłuższym niż RTO (`⟨DO ZMIERZENIA⟩`).

### Kolejność kroków

1. **Zatrzymaj ruch (fail-safe).** W Vercelu włącz stronę „przerwa techniczna" lub wyłącz
   deploymenty panelu/storefrontu, żeby nie dopisywać wierszy do odtwarzanej bazy.
2. **Wybierz źródło odtworzenia** (`⟨DO USTALENIA⟩` — zależy od owner-pending #1, #2):
   - **PITR** (jeśli włączony, #1): przywróć do punktu tuż przed awarią — minimalne RPO.
   - **Nocna kopia** (jeśli #2 istnieje): przywróć ostatni pełny zrzut — RPO do 24 h.
   - Jeśli ani PITR, ani zewnętrzna kopia nie są ustalone → **procedura zablokowana** na
     decyzji właściciela. Nie ma z czego odtwarzać poza wewnętrznymi backupami Supabase
     (zweryfikować ich zasięg i retencję).
3. **Odtwórz schemat, jeśli tworzysz nowy projekt Supabase.** Źródłem prawdy są migracje
   (`packages/db/supabase/migrations/*`) — zastosuj je po kolei. Dane z kopii zakładają
   schemat na wersji `⟨migracja z chwili kopii⟩`; niezgodność wersji migracji = STOP przed
   wgraniem danych.
4. **Wgraj dane** z wybranego źródła (PITR/kopia).
5. **Odtwórz Storage** (obrazy) — osobny restore bucketów; sprawdź, czy nocna kopia obejmuje
   Storage, czy tylko Postgres (`⟨DO USTALENIA⟩`).
6. **Uzupełnij env w Vercelu** ze spisu (`spis-env-avably.md`) — w szczególności
   `AVABLY_SECRETS_KEY_*` (bez nich sekrety martwe, patrz scenariusz C).
7. **Przełącz aplikację** na odtworzony projekt (jeśli zmienił się `NEXT_PUBLIC_SUPABASE_URL`
   / `SUPABASE_SECRET_KEY` — to zmienne **build-time/runtime**; `NEXT_PUBLIC_*` wymagają
   **przebudowy**, nie tylko restartu).
8. **Weryfikacja** (sekcja 5) — spójność, izolacja RLS, sekrety, storage.
9. **Wznów ruch** — zdejmij przerwę techniczną, przywróć deploymenty.

### Czego NIE robić
- Nie wgrywaj danych na schemat w innej wersji migracji niż kopia (rozjazd FK/kolumn).
- Nie „poprawiaj" nazw env z powrotem do przestrzeni dostawcy (`STRIPE_*`, `VERCEL_*`) —
  kolizja z systemowymi zmiennymi Vercela (ADR-049). Zostaw prefiks `AVABLY_`.

---

## 3. Scenariusz B — uszkodzenie/utrata danych JEDNEGO najemcy

**Objaw:** dane jednego tenanta skasowane / uszkodzone (np. błędna operacja), reszta systemu
zdrowa. Pełny restore bazy jest **nieproporcjonalny** — cofnąłby też wszystkich innych najemców.

**Cel:** odtworzyć wyłącznie dane dotkniętego najemcy z jego eksportu (I5.6), bez ruszania
pozostałych tenantów.

### Narzędzie
`scripts/dr/restore-tenant.mjs` — **szkielet planera** (I5.7). Parsuje manifest eksportu
per-najemca i wypisuje **plan** odtworzenia (dry-run). Realne wstawianie jest świadomie
zablokowane (patrz niżej).

```bash
# wzorcowy manifest (do zapoznania się z kształtem):
node scripts/dr/restore-tenant.mjs --example > /tmp/manifest.json

# plan odtworzenia (BEZ zapisu, BEZ sieci, BEZ produkcji):
node scripts/dr/restore-tenant.mjs --dry-run /tmp/manifest.json
```

### Kolejność kroków (respektuje FK i granicę tenanta)

1. **Zabezpiecz obecny stan** dotkniętego najemcy (jeśli cokolwiek zostało) — zrzut przed
   odtworzeniem, żeby nie nadpisać częściowych danych bez kopii.
2. **Odtwórz schemat = migracje.** Zakładamy, że współdzielony schemat jest zdrowy (awaria
   dotyczy danych, nie struktury). Jeśli nie — najpierw scenariusz A.
3. **Wstaw dane w kolejności warstw FK** (planer wypisuje ją z manifestu):
   `tenants` → `tenant_settings`/`members` → katalog (`catalog_categories`, `products`) →
   dzieci produktów (`product_units`, `product_categories`) → `customers` → `orders` →
   `order_items` → `sites`/`site_sections`/`domains` → dokumenty prawne → dzienniki.
   Rodzic **zawsze** przed dzieckiem — inaczej FK odrzuci wstawienie.
4. **Odtwórz sekrety** (`tenant_secrets`) — koperty AES-256-GCM. Wymagają klucza ze
   środowiska (scenariusz C). Koperta jest związana z `(tenant_id, key)` jako AAD, więc
   **nie przełożysz** cudzej koperty do tego tenanta — fail-closed.
5. **Odtwórz pliki w Storage** dla prefiksu tego najemcy (`tenant/<id>/`) — PO metadanych
   (`product_images`/`site_image_uploads` wskazują ścieżki).
6. **Weryfikacja izolacji** (sekcja 5) — odtworzone wiersze **nie mogą** być widoczne dla
   innych tenantów ani odwrotnie. To najważniejsza bramka tego scenariusza.
7. **Wznów ruch** dla tego najemcy (nie było potrzeby globalnej przerwy).

### Blokada realnego wykonania (świadoma)
Skrypt uruchomiony z `--execute` **rzuca błędem** — realne odtwarzanie wymaga:
(a) gotowego backupu/PITR (owner-pending #1),
(b) depozytu klucza sekretów (owner-pending #3),
(c) jawnego potwierdzenia operatora
oraz **finalnego formatu eksportu I5.6** (dziś założony kształt, `// TODO: dopiąć`).
Do tego czasu skrypt służy wyłącznie do **planowania** (dry-run).

---

## 4. Scenariusz C — utrata sekretów

**Objaw:** dane w `tenant_secrets` są (zaszyfrowane koperty), ale **klucz** szyfrujący
(`AVABLY_SECRETS_KEY_V*`) przepadł — np. skasowany z Vercela bez depozytu, albo nowe
środowisko go nie ma.

**Skutek:** koperty są **nieodwracalnie nieczytelne**. To najgorszy, cichy tryb awarii:
baza wygląda na zdrową, integracje najemców (kurierzy, tokeny) przestają działać, a hasła
nie da się odzyskać — bo aplikacja nigdy nie trzyma ich jawnie.

### Model (ADR-052)
- Sekrety najemcy szyfrowane **aplikacyjnie**, nie przez Supabase Vault (Vault niedostępny na
  hostowanym Supabase — decyzja ADR-052).
- Format koperty: `v1:<wersja>:<iv>:<tag>:<ct>` — **AES-256-GCM**.
- AAD = `${tenantId}:${key}` — koperta związana z konkretnym wierszem (nie do przeniesienia).
- Keyring z env: `AVABLY_SECRETS_KEY_CURRENT` (wskaźnik aktywnej wersji) + `AVABLY_SECRETS_KEY_V1`,
  `_V2`, … (materiał klucza per wersja). **Klucze NIE leżą w bazie** — to celowa separacja:
  kto ma dostęp do zrzutu bazy, nadal nie odczyta sekretów bez klucza z osobnego miejsca.

### Kolejność kroków

1. **Ustal, czy klucz istnieje gdziekolwiek** — depozyt poza bazą i poza Vercelem
   (owner-pending #3, `⟨DO USTALENIA⟩`). Jeśli tak — wgraj `AVABLY_SECRETS_KEY_V*` z depozytu
   do env i przejdź do kroku 4.
2. **Jeśli klucza NIE ma nigdzie** — sekretów **nie da się** odzyskać. Nie ma obejścia
   kryptograficznego (to jest cel projektu). Trzeba:
   - poprosić każdego dotkniętego najemcę o **ponowne wprowadzenie** integracji (hasła
     kuriera, tokeny), które zaszyfrują się nowym kluczem;
   - potraktować to jako incydent i wyciągnąć wniosek do owner-pending #3 (depozyt).
3. **Rotacja (jeśli klucz mógł wyciec, a nie zaginąć):** wygeneruj nową wersję
   (`AVABLY_SECRETS_KEY_V<n+1>`), ustaw `AVABLY_SECRETS_KEY_CURRENT=<n+1>`, **zostaw stare
   wersje** w env do czasu przeszyfrowania kopert (odczyt po starej, zapis po nowej wersji).
4. **Weryfikacja:** próbne odszyfrowanie jednej koperty per dotknięty najemca. Błąd odczytu
   (SecretEnvelopeError) = klucz nie pasuje lub koperta uszkodzona — nie idź dalej.

### Czego NIE robić
- Nie kasuj starych wersji klucza, dopóki istnieją koperty zaszyfrowane tą wersją.
- Nie loguj wartości jawnych sekretów ani szyfrogramów (moduł koperty tego pilnuje — nie
  obchodź go ręcznie).

---

## 5. Weryfikacja spójności i izolacji (wspólna dla A/B/C)

Po każdym odtworzeniu — zanim wznowisz ruch:

1. **Izolacja RLS (najważniejsze).** Zaloguj się jako najemca i potwierdź, że widzi
   **wyłącznie swoje** wiersze — katalog, zamówienia, klientów. Kontrola pozytywna
   (widać swoje) **i** negatywna (nie widać cudzych). Dla scenariusza B: żaden inny tenant
   nie widzi odtworzonego, i odwrotnie.
2. **Spójność FK.** Brak osieroconych rekordów: każdy `order_items` ma `orders`, każdy
   `product_units` ma `products`, każdy `site_sections` ma `sites`. Zapytania kontrolne po
   `LEFT JOIN ... WHERE parent IS NULL` powinny zwracać 0 wierszy.
3. **Sekrety.** Próbne odszyfrowanie jednej koperty kluczem ze środowiska — potwierdza, że
   klucz i dane pasują.
4. **Storage.** Metadane obrazów (`product_images`) mają pokrycie w obiektach bucketa (brak
   „martwych" ścieżek i brak obiektów-sierot).
5. **Auth.** Właściciele najemców mogą się zalogować (`members` ↔ `auth.users` spójne).
6. **Ścieżki krytyczne end-to-end.** Katalog sklepu ładuje się publicznie; checkout tworzy
   zamówienie; panel pokazuje dane. Dopiero wtedy zdejmij przerwę techniczną.

---

## 6. Test odtworzenia (do wykonania PÓŹNIEJ — nie teraz)

Ćwiczenie DR na żywo jest **osobnym zadaniem**, wykonalnym dopiero **gdy backup/PITR są
ustalone i włączone** (owner-pending #1, #2). Poniżej JAK je przeprowadzić — bez wykonywania:

1. **Izolowany cel.** Utwórz oddzielny projekt Supabase (nie produkcja, nie współdzielona
   lokalna baza — patrz lekcja o kontencji sesji).
2. **Scenariusz A na sucho.** Odtwórz schemat z migracji, wgraj ostatnią nocną kopię / punkt
   PITR do izolowanego projektu, zmierz **realny RPO i RTO** (owner-pending #4, #5 — to jest
   ich pomiar).
3. **Scenariusz B na sucho.** Wygeneruj eksport I5.6 jednego najemcy, uruchom
   `restore-tenant.mjs --dry-run`, a po dopięciu formatu I5.6 i odblokowaniu `--execute` —
   odtwórz go do izolowanego projektu i przejdź weryfikację izolacji (sekcja 5).
4. **Scenariusz C na sucho.** Zasymuluj brak klucza (usuń `AVABLY_SECRETS_KEY_V*` w
   izolowanym env) i potwierdź, że odczyt sekretu **fail-close** (błąd, nie ciche zero), a
   po przywróceniu klucza z depozytu wraca do działania.
5. **Zapisz wynik** (zmierzone RPO/RTO, napotkane luki) i **zaktualizuj ten runbook** — w
   szczególności pola `⟨DO USTALENIA/ZMIERZENIA⟩` w sekcji 0.

---

## Dziennik

- **2026-08-24** — utworzenie runbooka DR (I5.7, ADR-256). Trzy scenariusze (A/B/C),
  inwentarz zależności infra, szkielet `scripts/dr/restore-tenant.mjs` (dry-run). Fundamenty
  owner-pending (PITR, magazyn kopii, depozyt klucza, RPO/RTO) oznaczone jawnie — bez
  zgadywania wartości. Zwrócono uwagę na lukę w spisie env (brak `AVABLY_SECRETS_KEY_*`).
