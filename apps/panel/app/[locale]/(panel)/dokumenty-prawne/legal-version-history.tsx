import { useTranslations } from "next-intl";

import type { LegalVersionView } from "./types";

/**
 * REJESTR WERSJI dokumentu — ten sam widok u właściciela i u personelu.
 *
 * Wersje są niezmienne z konstrukcji (0063: brak GRANT-u UPDATE/DELETE plus
 * strażnik), więc lista nie ma i nie może mieć żadnej akcji. Skrót sha256
 * stoi obok numeru nie jako ozdoba: to jedyna rzecz na tym ekranie, po której
 * da się na oko stwierdzić, że dwie wersje różnią się treścią, a nie tylko
 * datą.
 *
 * Treść dokumentu renderujemy jako TEKST (tu w ogóle jej nie ma; w polach
 * edycji przez `defaultValue`) — nigdy `dangerouslySetInnerHTML`. To tekst
 * pisany przez najemcę i trafia na publiczną stronę sklepu.
 */
export function LegalVersionHistory({ versions }: { versions: LegalVersionView[] }) {
  const t = useTranslations("legalDocuments");

  return (
    <div data-legal-history className="flex flex-col gap-2">
      <p className="text-[13px] leading-[18px] font-medium">{t("historyTitle")}</p>
      {versions.length === 0 ? (
        <p className="text-muted-foreground text-[13px] leading-[18px]">{t("historyEmpty")}</p>
      ) : (
        <ul className="border-border flex list-none flex-col gap-0 rounded-md border p-0">
          {versions.map((version) => (
            <li
              key={version.id}
              data-legal-version={version.versionLabel}
              className="border-border flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-3 py-2 last:border-b-0"
            >
              <span className="text-sm font-medium tabular-nums">{version.versionLabel}</span>
              <span className="text-muted-foreground text-[13px] leading-[18px] tabular-nums">
                {version.publishedAtLabel}
              </span>
              <span className="text-muted-foreground font-mono text-[12px] leading-[18px]">
                {t("historyChecksum", { checksum: version.checksum })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
