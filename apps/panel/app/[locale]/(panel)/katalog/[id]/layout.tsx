import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { RecordTabs } from "@/components/screens/record-tabs";
import { ScreenBackLink } from "@/components/screens/screen-header";
import { uuidSchema } from "@/lib/catalog-validation";
import { requireMemberPage } from "@/lib/member-page";

/**
 * POWŁOKA KARTY PRODUKTU (U8b, ADR-146).
 *
 * Wcześniej podstrony produktu (Egzemplarze / Progi cenowe / Zdjęcia) wisiały
 * jako trzy przyciski w prawym górnym rogu ekranu edycji, a każda z nich
 * powtarzała własny link powrotny i własny tytuł z nazwą produktu. Operator
 * nie widział, że stoi WEWNĄTRZ jednego rekordu — widział cztery osobne
 * ekrany o podobnych nazwach.
 *
 * Layout jest naturalnym miejscem tego paska, bo Next.js NIE przerysowuje go
 * przy nawigacji między dziećmi: nazwa produktu i zakładki zostają na
 * miejscu, zmienia się wyłącznie treść pod nimi.
 *
 * `/katalog/nowy` i `/katalog/import` NIE są tym objęte — to statyczne
 * segmenty RÓWNOLEGŁE do `[id]`, a nie jego dzieci (sprawdzone w drzewie
 * tras, nie założone). Segment statyczny wygrywa też z dynamicznym przy
 * dopasowaniu, więc `/katalog/nowy` nigdy nie wejdzie w `[id]`.
 *
 * TYTUŁ EKRANU niesie belka panelu (ADR-060: `matchNavItem` dopasowuje
 * `/katalog` prefiksem, więc `<h1>` mówi „Katalog"). Nazwa produktu jest tu
 * `<h2>` — nazwą REKORDU, nie drugim tytułem ekranu.
 */
export default async function ProductRecordLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Własny guard, mimo że każda podstrona ma swój: layout SAM czyta bazę
  // (nazwa produktu), więc musi mieć własny kontekst — a konwencja panelu
  // brzmi „twardą bramką jest requireMember na KAŻDYM ekranie", nie na jednym
  // wspólnym przodku (patrz `(panel)/layout.tsx`).
  const ctx = await requireMemberPage(`/katalog/${id}`);

  // Identyfikator spoza UUID nie ma prawa dojść do bazy: `.eq` na kolumnie
  // uuid oddałoby błąd składni (22P02), a nie „nie ma takiego produktu".
  if (!uuidSchema.safeParse(id).success) notFound();

  const { data: product } = await ctx.supabase
    .from("products")
    .select("id, name")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .maybeSingle();

  if (!product) notFound();

  const t = await getTranslations("catalog.record");

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-3">
        <ScreenBackLink href="/katalog" label={t("backToList")} />
        <h2 className="text-2xl leading-[30px] font-semibold tracking-[-0.02em]">{product.name}</h2>
      </header>

      <RecordTabs
        label={t("tabsLabel")}
        items={[
          { href: `/katalog/${product.id}`, label: t("tabData") },
          { href: `/katalog/${product.id}/egzemplarze`, label: t("tabUnits") },
          { href: `/katalog/${product.id}/progi`, label: t("tabTiers") },
          { href: `/katalog/${product.id}/zdjecia`, label: t("tabImages") },
        ]}
      />

      {children}
    </div>
  );
}
