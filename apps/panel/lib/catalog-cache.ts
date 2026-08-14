/**
 * UNIEWAŻNIANIE CACHE KATALOGU W SKLEPIE (faza 4a, ADR-185).
 *
 * ==================== DLACZEGO TO NIE JEST `revalidateTag` ====================
 *
 * Panel i sklep to dwie OSOBNE aplikacje Next, budowane i wdrażane niezależnie,
 * bez wspólnego `cacheHandler`. Wszystkie wywołania `revalidatePath("/",
 * "layout")` i `revalidateTag(tenantCacheTag(...))` w tym pakiecie odświeżają
 * EKRANY PANELU — do cache'u sklepu nie mają żadnej drogi i nigdy nie miały.
 * Do fazy 4a nie miało to znaczenia, bo sklep nie buforował niczego między
 * żądaniami. Od ADR-185 buforuje kopertę katalogu, więc potrzebny jest kanał,
 * którym operator mówi sklepowi „to, co masz, jest już nieaktualne".
 *
 * Kanałem jest MAGAZYN WSPÓŁDZIELONY (Upstash), do którego sięgają obie
 * aplikacje, a kluczem — jedno wyrażenie z rdzenia (`publicCatalogCacheKey`),
 * żeby strona zapisująca i strona kasująca nie mogły się rozjechać.
 *
 * ==================== NIESKUTECZNOŚĆ MUSI BYĆ GŁOŚNA — ALE TYLKO TAM, GDZIE JEST WADĄ ====================
 *
 * Nieudane unieważnienie znaczy „operator zmienił cenę, a klient przez
 * najbliższą minutę widzi starą" — czyli tę samą klasę cichej awarii, którą
 * zamykały ADR-171/172. Dlatego błąd sieci przy kasowaniu idzie do logu ZAWSZE.
 *
 * BRAK KONFIGURACJI MAGAZYNU JEST CZYM INNYM i rozróżnienie jest tu istotne:
 * w dev, w CI i przy jednej instancji to jest stan NORMALNY (sklep trzyma wpis
 * w pamięci procesu, TTL 60 s domyka resztę), a nie usterka. Log przy każdej
 * mutacji katalogu byłby wtedy szumem, który uczy zespół przewijać błędy —
 * i dokładnie tak wywrócił suitę uploadu zdjęć, która słusznie pilnuje, żeby
 * droga szczęśliwa nie pisała do `console.error`. Alarm zostaje więc zawężony
 * do PRODUKCJI, gdzie brak magazynu jest realnym błędem wdrożenia.
 *
 * Nieudane unieważnienie NIE przewraca akcji panelu: dane w bazie są już
 * zmienione, a odmowa zapisu z powodu cache'u byłaby gorsza od minutowej
 * nieświeżości.
 */
import { Redis } from "@upstash/redis";

import { publicCatalogCacheKey } from "@avably/core/site";

let cachedRedis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (cachedRedis !== undefined) return cachedRedis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  cachedRedis = url && token ? new Redis({ url, token }) : null;
  return cachedRedis;
}

/**
 * Kasuje wpis cache katalogu TEGO najemcy w sklepie.
 *
 * `tenantId` pochodzi z kontekstu członkostwa (`memberCtx`), nigdy z wejścia
 * akcji — inaczej byłaby to droga, którą członek jednego najemcy zrzuca cache
 * drugiemu. To nie jest wyciek danych, ale jest to zdalne kasowanie cudzego
 * stanu i nie ma powodu, żeby było możliwe.
 */
export async function invalidateStorefrontCatalog(tenantId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    // Na produkcji brak magazynu współdzielonego to błąd WDROŻENIA (zmienne
    // UPSTASH_* nie doszły do projektu panelu), a nie stan pracy. Poza
    // produkcją to normalna konfiguracja — patrz nagłówek pliku.
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[katalog] brak UPSTASH_REDIS_REST_URL/TOKEN w panelu — nie mam czym unieważnić cache " +
          "katalogu w sklepie; klient zobaczy zmianę dopiero po wygaśnięciu TTL (60 s)",
      );
    }
    return;
  }
  try {
    await redis.del(publicCatalogCacheKey(tenantId));
  } catch (error) {
    console.error("[katalog] unieważnienie cache katalogu w sklepie nie powiodło się", error);
  }
}

/** Reset stanu — WYŁĄCZNIE do testów. */
export function __resetCatalogInvalidationForTests(): void {
  cachedRedis = undefined;
}
