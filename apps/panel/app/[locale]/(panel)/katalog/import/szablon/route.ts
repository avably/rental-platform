/**
 * GET /{locale}/katalog/import/szablon — pusty szablon CSV importu katalogu
 * (uwaga właściciela #7, ADR-237).
 *
 * Nagłówki bierzemy z JEDNEGO źródła prawdy `lib/export/catalog` — tego samego
 * zestawu kolumn, który sprawdza parser importu (`lib/import/catalog-csv`).
 * Dzięki temu szablon nie może się rozjechać z tym, co import przyjmuje: gdyby
 * ktoś dodał kolumnę do formatu, szablon dostanie ją tą samą stałą, bez
 * przepisywania literałów w dwóch miejscach. Kolumnę kategorii dokładamy jawnie
 * (jest OPCJONALNA przy wczytywaniu, ale w szablonie ma się pojawić, żeby było
 * gdzie wpisać przynależność) — dokładnie jak robi to eksport.
 *
 * Serializacja przez `buildCsv` (BOM + CRLF + neutralizacja) — ta sama, którą
 * generuje eksport, więc plik otwiera się w Excelu tak samo jak eksport.
 *
 * Guard PRZED jakąkolwiek pracą: anonim dostaje status odmowy, zanim powstanie
 * plik. Szablon nie niesie danych najemcy, ale endpoint zostaje uwierzytelniony
 * jak reszta panelu — pobranie jest częścią pracy zalogowanego operatora.
 */
import { AuthError } from "@/lib/auth";
import { CATALOG_CSV_CATEGORIES_COLUMN, CATALOG_CSV_HEADER } from "@/lib/export/catalog";
import { buildCsv } from "@/lib/export/csv";
import { requireMember } from "@/lib/supabase-server";

export async function GET(): Promise<Response> {
  try {
    await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return new Response(null, { status: err.status });
    throw err;
  }

  const csv = buildCsv([...CATALOG_CSV_HEADER, CATALOG_CSV_CATEGORIES_COLUMN], []);

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="szablon-katalogu.csv"',
      "cache-control": "private, no-store",
    },
  });
}
