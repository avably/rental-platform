"use client";

/**
 * EDYCJA TEKSTU W MIEJSCU (K3, ADR-086) — WYSIWYG-light na płótnie.
 *
 * Operator pisze W ELEMENCIE, nie w polu obok. Sztuczka jest prosta i dlatego
 * dobra: `contenteditable` siada na OWIJCE wokół wyrenderowanego elementu, więc
 * edytowany tekst ma dokładnie tę typografię, którą zobaczy klient — nie ma
 * drugiego zestawu stylów „dla edytora", który mógłby się rozjechać z pierwszym.
 *
 * Poddrzewo jest NIEKONTROLOWANE: React nie przerysowuje go w trakcie pisania
 * (treść elementu w stanie nie zmienia się aż do zatwierdzenia), więc kursor
 * nie skacze na początek po każdym znaku — klasyczna wada sterowanego
 * `contenteditable`.
 *
 * ZBIÓR CECH JEST ZAMKNIĘTY: pogrubienie, pochylenie, link. Nic poza tym nie
 * wychodzi z bramy `runsFromDom`, a adres linku i tak przechodzi przez
 * allowlistę schematów w Zodzie. Formatowanie wykonuje `document.execCommand` —
 * przestarzałe, ale jedyne API, które działa w każdej przeglądarce na
 * zaznaczeniu wewnątrz `contenteditable`; ręczne operowanie zakresami byłoby
 * własną implementacją edytora tekstu, a to nie jest zadanie tego etapu.
 */
import { linkHrefSchema, type TextRun } from "@avably/core/site";
import { Button, Input, Tooltip, TooltipContent, TooltipTrigger } from "@avably/ui";
import { Bold, Italic, Link2, Link2Off } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { runsFromDom } from "./inline-text";

export function InlineTextEditor({
  onCommit,
  onCancel,
  children,
}: {
  /** Zatwierdzenie treści. Pusty wynik = operator skasował wszystko (wołający zostawia stare). */
  onCommit: (runs: TextRun[]) => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const t = useTranslations("site");
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

  // Kursor ląduje w tekście od razu — inaczej operator musiałby kliknąć drugi
  // raz w to samo miejsce, w które przed chwilą kliknął.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(host);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  function commit() {
    const host = hostRef.current;
    if (host) onCommit(runsFromDom(host));
  }

  function format(command: "bold" | "italic") {
    document.execCommand(command);
    hostRef.current?.focus();
  }

  function applyLink() {
    const parsed = linkHrefSchema.safeParse(href);
    if (!parsed.success) {
      // Adres odrzucamy TĄ SAMĄ regułą, którą odrzuci go zapis — operator
      // dowiaduje się od razu, a nie po zniknięciu linku przy zapisie.
      setLinkError(parsed.error.issues[0]?.message ?? t("inline.linkInvalid"));
      return;
    }
    document.execCommand("createLink", false, parsed.data);
    setLinkOpen(false);
    setHref("");
    setLinkError(null);
    hostRef.current?.focus();
  }

  return (
    <>
      <div
        data-inline-toolbar
        className="border-border bg-background absolute -top-11 left-0 z-[1002] flex items-center gap-1 rounded-md border p-1 shadow-sm"
        // Pasek nie może zabrać fokusu edytowanemu tekstowi — inaczej
        // zaznaczenie znika w chwili kliknięcia i formatować nie ma czego.
        onPointerDown={(event) => event.preventDefault()}
      >
        <FormatButton label={t("inline.bold")} icon={<Bold className="size-4" aria-hidden />} onClick={() => format("bold")} />
        <FormatButton label={t("inline.italic")} icon={<Italic className="size-4" aria-hidden />} onClick={() => format("italic")} />
        <FormatButton
          label={t("inline.link")}
          icon={<Link2 className="size-4" aria-hidden />}
          onClick={() => setLinkOpen((open) => !open)}
        />
        <FormatButton
          label={t("inline.unlink")}
          icon={<Link2Off className="size-4" aria-hidden />}
          onClick={() => {
            document.execCommand("unlink");
            hostRef.current?.focus();
          }}
        />
      </div>

      {linkOpen ? (
        <div
          data-inline-link-form
          className="border-border bg-background absolute -top-24 left-0 z-[1002] flex w-72 flex-col gap-2 rounded-md border p-2 shadow-sm"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Input
            aria-label={t("inline.linkAddress")}
            placeholder="https://…"
            value={href}
            onChange={(event) => {
              setHref(event.target.value);
              setLinkError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyLink();
              }
            }}
          />
          {linkError ? (
            <p role="alert" className="text-destructive text-xs">
              {linkError}
            </p>
          ) : null}
          <Button type="button" size="sm" variant="secondary" data-inline-link-apply onClick={applyLink}>
            {t("inline.linkApply")}
          </Button>
        </div>
      ) : null}

      <div
        ref={hostRef}
        data-inline-editor
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={t("inline.editing")}
        // Obrys edycji rysuje arkusz panelu (`[data-inline-editor]`) tokenem
        // warstwy edycyjnej — patrz komentarz tam.
        className="size-full"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            commit();
            onCancel();
          }
        }}
        onBlur={(event) => {
          // Kliknięcie w pasek formatowania NIE kończy edycji — pasek leży poza
          // edytowanym pudełkiem, więc bez tego sprawdzenia pogrubienie
          // zamykałoby edytor, zamiast pogrubiać.
          if (event.relatedTarget instanceof Node && event.currentTarget.parentElement?.contains(event.relatedTarget)) {
            return;
          }
          commit();
          onCancel();
        }}
      >
        {children}
      </div>
    </>
  );
}

function FormatButton({ label, icon, onClick }: { label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-inline-format
          aria-label={label}
          onClick={onClick}
          className="text-muted-foreground hover:text-foreground focus-visible:border-foreground focus-visible:outline-accent dark:focus-visible:outline-ring flex size-7 cursor-pointer items-center justify-center rounded-md border border-transparent outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2"
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
