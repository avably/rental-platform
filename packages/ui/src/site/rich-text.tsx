import * as React from "react";

import { cn } from "../lib/cn";

/**
 * Bezpieczny render tekstu tenanta (sekcja freeform).
 *
 * BRAMKA XSS: treść freeform pochodzi od najemcy i jest serwowana anonimowemu
 * kupującemu. NIGDY nie renderujemy jej przez `dangerouslySetInnerHTML` —
 * zamiast tego parsujemy do struktury i oddajemy React-owi jako węzły tekstowe,
 * które React escapuje z urzędu. Dzięki temu `<script>` czy `onerror=` w treści
 * to zwykły, wyświetlony tekst, nie wykonany kod.
 *
 * Obsługiwany podzbiór (świadomie mały — pełny markdown to osobne zadanie):
 * - akapity rozdzielone pustą linią,
 * - twarde złamania linii (pojedynczy `\n`) w akapicie,
 * - pogrubienie `**tekst**` (parowane gwiazdki) → <strong>.
 * Wszystko inne zostaje dosłownym tekstem.
 */

interface BoldRun {
  text: string;
  bold: boolean;
}

/**
 * Dzieli jedną linię na przebiegi zwykły/pogrubiony po parach `**`. Nieparzysta
 * (niesparowana) gwiazdka zostaje dosłownym tekstem — bez „wiszącego” <strong>.
 */
export function parseInlineBold(line: string): BoldRun[] {
  const parts = line.split("**");
  // Nieparzysta liczba separatorów `**` = ostatnia gwiazdka wisi. Wtedy NIE
  // interpretujemy pogrubienia w ogóle — cała linia zostaje dosłownym tekstem
  // z zachowanym `**` (inaczej zgubilibyśmy separatory, np. „cena **od”).
  const paired = parts.length % 2 === 1;
  if (!paired) return [{ text: line, bold: false }];

  const runs: BoldRun[] = [];
  parts.forEach((part, index) => {
    if (part === "") return;
    runs.push({ text: part, bold: index % 2 === 1 });
  });
  if (runs.length === 0) runs.push({ text: "", bold: false });
  return runs;
}

/** Struktura akapitów: bloki rozdzielone pustą linią, każdy jako lista linii. */
export function parseParagraphs(body: string): string[][] {
  return body
    .replace(/\r\n/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((block) => block.split("\n").map((line) => line.trim()))
    .map((lines) => lines.filter((line) => line.length > 0))
    .filter((lines) => lines.length > 0);
}

function InlineText({ line }: { line: string }) {
  return (
    <>
      {parseInlineBold(line).map((run, index) =>
        run.bold ? <strong key={index}>{run.text}</strong> : <React.Fragment key={index}>{run.text}</React.Fragment>,
      )}
    </>
  );
}

export function SafeRichText({ body, className }: { body: string; className?: string }) {
  const paragraphs = parseParagraphs(body);
  if (paragraphs.length === 0) return null;

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {paragraphs.map((lines, pIndex) => (
        <p key={pIndex} className="leading-relaxed">
          {lines.map((line, lIndex) => (
            <React.Fragment key={lIndex}>
              {lIndex > 0 ? <br /> : null}
              <InlineText line={line} />
            </React.Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}
