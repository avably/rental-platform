/**
 * ZMNIEJSZANIE OBRAZU PRZED WYSŁANIEM (S-46, audyt UX 2026-08-25).
 *
 * Znak sklepu wgrany przez właściciela miał 3722 px wysokości i jechał do
 * Storage w całości — a stoi w nagłówku sklepu jako obrazek wysoki na kilkadziesiąt
 * pikseli, PRELOADOWANY na każdej stronie. Klient pobierał więc megabajty, żeby
 * je natychmiast przeskalować do nieczytelnego ułamka. To nie jest kwestia
 * limitu (plik przechodził), tylko tego, ile waży pierwszy ekran sklepu.
 *
 * ================== DWIE CZĘŚCI, BO JEDNA JEST TESTOWALNA ==================
 *
 * `logoResizePlan` jest funkcją CZYSTĄ i odpowiada na jedyne pytanie, które ma
 * tu regułę: jakie wymiary ma mieć wynik. `downscaleImage` robi resztę — dekoduje,
 * rysuje, koduje — czyli dotyka `createImageBitmap`, `canvas` i `toBlob`, których
 * jsdom nie ma. Rozdzielenie znaczy, że reguła ma test bez przeglądarki, a
 * przeglądarkowa połowa nie ma w sobie ani jednej decyzji do przetestowania.
 *
 * ================== ZMNIEJSZENIE JEST ULEPSZENIEM, NIE BRAMKĄ ==================
 *
 * KAŻDA awaria tej ścieżki (brak `createImageBitmap`, brak kontekstu 2D,
 * `toBlob` oddające `null`, kodek nieobsługiwany) kończy się ZWRÓCENIEM PLIKU
 * WEJŚCIOWEGO. Upload, który przestałby działać dlatego, że nie udało się
 * zmniejszyć obrazu, byłby gorszy od uploadu, który wysyła plik za duży.
 *
 * WYNIK WIĘKSZY OD WEJŚCIA TEŻ ODPADA. Mały PNG z płaskim logo bywa lżejszy niż
 * jego przekodowana wersja — a „optymalizacja", która pogarsza, jest po prostu
 * wadą z dobrą intencją.
 *
 * ================== DLACZEGO WEBP Z FALLBACKIEM ==================
 *
 * `toBlob` ze specyfikacji ma OBOWIĄZEK oddać obraz także wtedy, gdy podanego
 * typu nie zna — wraca wówczas `image/png`. Nie sprawdzamy więc, „czy ta
 * przeglądarka umie WebP" (sprawdzanie cech silnika to zgadywanie o Safari
 * z Chromium w tle), tylko CZYTAMY TYP tego, co dostaliśmy, i pilnujemy, żeby
 * należał do allowlisty bucketa. PNG jest w niej i zachowuje przezroczystość,
 * więc fallback nie psuje znaku z kanałem alfa — czego JPEG by nie uniósł.
 */
import { SITE_IMAGE_MIME_EXTENSIONS } from "@/lib/site-image-file";

/**
 * Sufit wysokości znaku po zmniejszeniu (px). Nagłówek sklepu rysuje logo
 * w skali kilkudziesięciu pikseli, więc 512 px zostawia zapas na ekrany o
 * podwójnej i potrójnej gęstości i na przyszłe, większe użycie znaku — a odcina
 * rząd wielkości, o który chodzi w tym findingu.
 */
export const LOGO_MAX_HEIGHT_PX = 512;

/** Jakość kodowania stratnego — próg, powyżej którego oko przestaje widzieć różnicę. */
const QUALITY = 0.9;

/**
 * Docelowe wymiary albo `null`, gdy obraz nie wymaga zmniejszenia.
 *
 * Proporcje zostają: skala liczy się z WYSOKOŚCI, bo to ona jest ograniczeniem
 * znaku w nagłówku — szerokie logo poziome ma zostać szerokie. Zaokrąglenie
 * szerokości nie może dać zera (obraz o zerowej szerokości nie jest obrazem),
 * stąd `Math.max(1, …)`; przy skrajnie wąskim, wysokim pliku to jedyny wynik,
 * który da się narysować.
 */
export function logoResizePlan(
  width: number,
  height: number,
): { width: number; height: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  if (height <= LOGO_MAX_HEIGHT_PX) return null;
  const scale = LOGO_MAX_HEIGHT_PX / height;
  return { width: Math.max(1, Math.round(width * scale)), height: LOGO_MAX_HEIGHT_PX };
}

/**
 * Plik zmniejszony do sufitu wysokości — albo WEJŚCIE bez zmian, gdy
 * zmniejszenie nie jest potrzebne, nie jest możliwe albo nic nie daje.
 *
 * Funkcja nie rzuca NIGDY: patrz nagłówek pliku (zmniejszenie jest ulepszeniem).
 */
export async function downscaleImage(file: File): Promise<File> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const plan = logoResizePlan(bitmap.width, bitmap.height);
    if (!plan) return file;

    const canvas = document.createElement("canvas");
    canvas.width = plan.width;
    canvas.height = plan.height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, plan.width, plan.height);

    const blob = await new Promise<Blob | null>((resolve) => {
      // Zawijamy w try, bo starsze silniki potrafią RZUCIĆ na nieznanym typie
      // zamiast oddać PNG — a wtedy obietnica zostałaby nierozwiązana na zawsze
      // i upload wisiałby bez komunikatu.
      try {
        canvas.toBlob((result) => resolve(result), "image/webp", QUALITY);
      } catch {
        resolve(null);
      }
    });
    if (!blob || blob.size === 0) return file;
    if (!(blob.type in SITE_IMAGE_MIME_EXTENSIONS)) return file;
    if (blob.size >= file.size) return file;

    const extension = SITE_IMAGE_MIME_EXTENSIONS[blob.type as keyof typeof SITE_IMAGE_MIME_EXTENSIONS];
    const stem = file.name.replace(/\.[^.]+$/, "") || "logo";
    return new File([blob], `${stem}.${extension}`, { type: blob.type });
  } catch {
    return file;
  } finally {
    bitmap?.close?.();
  }
}
