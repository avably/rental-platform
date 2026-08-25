/**
 * Klient uploadu LOGO najemcy (ADR-160) — lustro `./upload-flow.ts`.
 *
 * Różnica jest jedna i jest nią KONTROLA WSTĘPNA: znak ma własny sufit
 * (512 KiB), więc plik za duży ma paść w przeglądarce, zanim pojedzie
 * na serwer. Bajty wgrywa przeglądarka wprost do podpisanego URL-a — tym samym
 * wywołaniem, co przy zdjęciu sekcji (ten sam bucket, ta sama funkcja).
 *
 * ================== ZMNIEJSZENIE PRZED WYSŁANIEM (S-46) ==================
 *
 * Od audytu UX 2026-08-25 znak przechodzi przez `downscaleImage` ZANIM cokolwiek
 * pojedzie na serwer — powód i mechanika stoją przy tamtej funkcji. Kolejność
 * kontroli jest tu decyzją, a nie przypadkiem:
 *
 *   1. TYP i PUSTKA sprawdzane na pliku WEJŚCIOWYM. Nie ma sensu podawać
 *      dekoderowi pliku, o którym już wiadomo, że nie jest obrazem z allowlisty;
 *   2. ZMNIEJSZENIE;
 *   3. SUFIT ROZMIARU sprawdzany na WYNIKU. To jest ta zmiana, która ma
 *      znaczenie dla operatora: znak 3 MB prosto z aparatu przechodził dotąd
 *      przez odmowę „najwyżej 512 KB", choć po zmniejszeniu do 512 px waży
 *      kilkadziesiąt kilobajtów. Sprawdzanie sufitu przed zmniejszeniem
 *      odrzucałoby pliki, które sami umiemy naprawić.
 */
import { downscaleImage } from "@/lib/image-downscale";
import type {
  FinalizeSiteImageUploadResult,
  PrepareSiteImageUploadResult,
} from "@/lib/site-image-upload";
import { checkTenantLogoMetadata, type TenantLogoFileProblem } from "@/lib/tenant-logo";

import { uploadSiteImageToSignedUrl } from "./upload-flow";

export type TenantLogoUploadOutcome = { ok: true; path: string } | { ok: false; error: string };

interface TenantLogoUploadFlowDependencies {
  prepare: (input: { mime: string; size: number }) => Promise<PrepareSiteImageUploadResult>;
  upload: (input: {
    path: string;
    token: string;
    file: File;
    contentType: string;
  }) => Promise<{ error: string | null }>;
  finalize: (uploadId: string) => Promise<FinalizeSiteImageUploadResult>;
  message: (problem: TenantLogoFileProblem | "upload") => string;
  /**
   * Zmniejszenie obrazu — wstrzykiwane, bo dotyka `canvas`, którego jsdom nie ma.
   * Produkcja podaje `downscaleImage`; test podaje własne, żeby sprawdzić, że
   * wysyłany jest WYNIK, a nie oryginał.
   */
  resize?: (file: File) => Promise<File>;
}

export { uploadSiteImageToSignedUrl };

export async function runTenantLogoUpload(
  input: File | null,
  deps: TenantLogoUploadFlowDependencies,
): Promise<TenantLogoUploadOutcome> {
  if (!input) return { ok: false, error: deps.message("missing") };

  if (input.size <= 0) return { ok: false, error: deps.message("empty") };
  if (checkTenantLogoMetadata({ size: 1, type: input.type })) {
    return { ok: false, error: deps.message("type") };
  }

  // Zmniejszenie NIE MA PRAWA wywrócić uploadu — `downscaleImage` oddaje wtedy
  // wejście. Ta gałąź domyka ten sam kontrakt dla implementacji wstrzykniętej.
  let file: File;
  try {
    file = (await (deps.resize ?? downscaleImage)(input)) ?? input;
  } catch {
    file = input;
  }

  const problem = checkTenantLogoMetadata(file);
  if (problem) return { ok: false, error: deps.message(problem) };

  const prepared = await deps.prepare({ mime: file.type, size: file.size });
  if (!prepared.ok) return { ok: false, error: prepared.error };

  const uploaded = await deps.upload({
    path: prepared.upload.path,
    token: prepared.upload.token,
    file,
    contentType: file.type,
  });
  if (uploaded.error) return { ok: false, error: deps.message("upload") };

  const finalized = await deps.finalize(prepared.upload.uploadId);
  if (!finalized.ok) return { ok: false, error: finalized.error };
  return { ok: true, path: finalized.path };
}
