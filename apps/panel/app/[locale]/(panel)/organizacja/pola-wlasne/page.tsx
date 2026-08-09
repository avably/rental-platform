/**
 * Pola własne — podstrona ekranu Organizacja (C6-A1, ADR-118).
 *
 * DLACZEGO TUTAJ, a nie własną pozycją w menu: pola własne opisują KSZTAŁT
 * danych całej organizacji (klient, zamówienie, produkt naraz), więc nie
 * należą do żadnego pojedynczego ekranu operacyjnego. Grupa „organizacja" to
 * sprawy firmy i konta (rozstrzygnięcie ADR-110, decyzja 14) — i jest to ta
 * sama grupa, w której mieszkają pozostałe czynności zastrzeżone dla
 * właściciela. Struktura menu zostaje NIETKNIĘTA (kontrakt z artefaktem Fazy 2
 * pilnuje liczby pozycji), a ekran osiąga się przyciskiem z karty organizacji
 * — dokładnie wzorcem `punkty-odbioru` i `katalog/import`.
 *
 * `force-dynamic`: trasa interaktywna — statyczny prerender + CSP nonce
 * zabiłyby hydrację po cichu (wzorzec kreatora, ADR-083).
 */
import { CUSTOM_FIELD_ENTITIES, customFieldDefinitionFromRow } from "@avably/core";
import { Button } from "@avably/ui";
import { getTranslations } from "next-intl/server";

import { ScreenHeader, ScreenSection } from "@/components/screens/screen-header";
import { Link } from "@/i18n/navigation";
import { requireMemberPage } from "@/lib/member-page";

import { moveDefinitionAction, toggleArchiveAction } from "./actions";
import { DefinitionsTable, type DefinitionRow } from "./definitions-table";

export const dynamic = "force-dynamic";

const LIST_PATH = "/organizacja/pola-wlasne";

export default async function CustomFieldsPage() {
  const ctx = await requireMemberPage(LIST_PATH);

  const { data: definitions } = await ctx.supabase
    .from("custom_field_definitions")
    .select(
      "id, entity, field_type, label, help_text, required, options, position, show_in_panel, show_in_checkout, show_in_contract, archived_at",
    )
    .eq("tenant_id", ctx.tenantId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  // Które pola mają już zapisane wartości — stąd bierze się chip „w użyciu"
  // i wygaszony wybór rodzaju na formularzu edycji. Funkcja jest SECURITY
  // INVOKER, więc jej zasięg wyznacza RLS encji, nie ten filtr.
  const { data: inUseRows } = await ctx.supabase.schema("app").rpc("custom_fields_in_use");
  const inUse = new Set(
    ((inUseRows ?? []) as { definition_id: string }[]).map((row) => row.definition_id),
  );

  const t = await getTranslations("customFields");
  const manage = ctx.role === "owner";

  const parsed = (definitions ?? []).map((row) =>
    customFieldDefinitionFromRow(row as Parameters<typeof customFieldDefinitionFromRow>[0]),
  );

  const surfaces = (definition: (typeof parsed)[number]): string => {
    const names = [
      definition.showInPanel ? t("surface.panel") : null,
      definition.showInCheckout ? t("surface.checkout") : null,
      definition.showInContract ? t("surface.contract") : null,
    ].filter(Boolean);
    return names.length > 0 ? names.join(", ") : "—";
  };

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        back={{ href: "/organizacja", label: t("backToOrganization") }}
        title={t("title")}
        actions={
          manage ? (
            <Button asChild>
              <Link href={`${LIST_PATH}/nowe`}>{t("newField")}</Link>
            </Button>
          ) : undefined
        }
      />

      <p className="text-muted-foreground text-sm">{t("intro")}</p>
      {manage ? null : <p className="text-muted-foreground text-sm">{t("readOnly")}</p>}

      {CUSTOM_FIELD_ENTITIES.map((entity) => {
        const forEntity = parsed.filter((definition) => definition.entity === entity);
        // Kolejność przesuwania liczy się WYŁĄCZNIE wśród żywych pól —
        // zarchiwizowane nie mają pozycji na formularzu, więc nie mogą też
        // zjadać skrajów listy.
        const live = forEntity.filter((definition) => definition.archivedAt === null);

        const rows: DefinitionRow[] = forEntity.map((definition) => {
          const liveIndex = live.findIndex((candidate) => candidate.id === definition.id);
          return {
            id: definition.id,
            label: definition.label,
            typeLabel: t(`type.${definition.type}`),
            required: definition.required,
            surfaces: surfaces(definition),
            inUse: inUse.has(definition.id),
            archived: definition.archivedAt !== null,
            first: liveIndex <= 0,
            last: liveIndex === live.length - 1,
            moveUpAction: moveDefinitionAction.bind(null, definition.id, "up"),
            moveDownAction: moveDefinitionAction.bind(null, definition.id, "down"),
            archiveAction: toggleArchiveAction.bind(
              null,
              definition.id,
              definition.archivedAt === null,
            ),
          };
        });

        return (
          <ScreenSection key={entity} title={t(`entity.${entity}`)}>
            {rows.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("emptyEntity")}</p>
            ) : (
              <DefinitionsTable rows={rows} manage={manage} />
            )}
          </ScreenSection>
        );
      })}
    </div>
  );
}
