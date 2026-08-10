"use client";

/**
 * DOKUMENT PRAWNY W WIDOKU WŁAŚCICIELA (B4, ADR-129).
 *
 * Karta łączy trzy rzeczy, których nie da się od siebie oderwać bez kłamstwa:
 * SZKIC (to, co edytujesz), STAN PUBLIKACJI (to, co widzi klient) i REJESTR
 * WERSJI (to, czego już nie zmienisz). Ekran, który pokazuje wyłącznie pole
 * edycji, sugeruje, że zapis = publikacja — a to jest dokładnie ta pomyłka,
 * przed którą chroni rozdział tabel w 0063.
 *
 * ZAPIS i PUBLIKACJA to DWA różne czasowniki i mają dwie różne drogi: zapis
 * idzie formularzem (`useActionState`), publikacja przez potwierdzenie
 * (`useTransition`), bo przestawia to, co widzą klienci. Wspólny przycisk
 * „Zapisz i opublikuj" odbierałby możliwość pisania regulaminu na raty.
 *
 * NIE UŻYWAMY WSPÓLNEGO `components/publish-dialog.tsx`: tamten dialog jest
 * związany ze słownikiem `site` i mówi o PRZEŁĄCZANIU wersji strony sklepu
 * („dotychczasowa strona przestanie być publiczna"). Tutaj publikacja niczego
 * nie gasi — dokłada wersję do rejestru — więc ta sama treść byłaby fałszem.
 * Kształt i droga potwierdzenia zostają te same.
 *
 * BEZPIECZEŃSTWO: ten komponent renderuje się WYŁĄCZNIE dla właściciela
 * (fork w `page.tsx`), ale to nie jest autoryzacja — bramką jest RLS 0063
 * i jawna bramka w `app.publish_legal_document`. Treść dokumentu idzie do
 * `defaultValue` / węzła tekstowego; `dangerouslySetInnerHTML` nie ma tu
 * prawa istnieć, bo ten tekst wychodzi na publiczną stronę sklepu.
 */
import { Button, Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Input, Label, Textarea } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState, useState, useTransition } from "react";

import { PanelSelect } from "@/components/fields/panel-select";
import { ScreenSection } from "@/components/screens/screen-header";
import type { FormState } from "@/lib/form-state";
import {
  LEGAL_BODY_MAX_LENGTH,
  LEGAL_TITLE_MAX_LENGTH,
  type LegalDocumentKind,
} from "@/lib/legal-documents";

import { publishLegalDocumentAction, saveLegalDocumentDraftAction } from "./actions";
import { LegalVersionHistory } from "./legal-version-history";
import type { LegalDocumentView } from "./types";

type PublishFeedback =
  | { kind: "created"; version: string }
  | { kind: "unchanged" }
  | { kind: "error"; message: string };

function SaveFeedback({ state }: { state: FormState }) {
  const t = useTranslations("legalDocuments");
  const message = state.formError ?? Object.values(state.fieldErrors ?? {})[0];
  if (message)
    return (
      <p role="alert" className="text-destructive text-sm">
        {message}
      </p>
    );
  // `notice` niesie WYŁĄCZNIE awarię lustra `terms_body` — zapis się udał,
  // więc to nie jest ani sukces bez zastrzeżeń, ani błąd.
  if (state.notice)
    return (
      <span data-legal-mirror-notice className="text-status-attention-fg text-sm">
        {state.notice}
      </span>
    );
  return state.success ? (
    <span className="text-status-positive-fg text-sm">{t("saved")}</span>
  ) : null;
}

export function LegalDocumentForm({
  kind,
  document,
}: {
  kind: LegalDocumentKind;
  document: LegalDocumentView | null;
}) {
  const t = useTranslations("legalDocuments");
  const [state, formAction, saving] = useActionState(saveLegalDocumentDraftAction, {});
  const [publishing, startPublishing] = useTransition();
  const [publishFeedback, setPublishFeedback] = useState<PublishFeedback | null>(null);

  const currentVersion = document?.currentVersionLabel ?? null;
  const currentPublishedAt = document?.currentPublishedAtLabel ?? "—";
  // Publikacja bez szkicu nie ma czego przenieść do rejestru — baza odpowie
  // `legal_document_not_found`, więc przycisk mówi to samo, zanim padnie klik.
  const publishable = document != null;

  function publish() {
    setPublishFeedback(null);
    startPublishing(async () => {
      const result = await publishLegalDocumentAction(kind);
      if (!result.ok) {
        setPublishFeedback({ kind: "error", message: result.error });
        return;
      }
      setPublishFeedback(
        result.created ? { kind: "created", version: result.versionLabel } : { kind: "unchanged" },
      );
    });
  }

  const busy = saving || publishing;

  return (
    <ScreenSection
      data-legal-document={kind}
      data-legal-mode="owner"
      title={t(`kind.${kind}`)}
    >
      <p data-legal-publish-status className="text-muted-foreground text-[13px] leading-[18px]">
        {currentVersion
          ? t("statusPublished", { version: currentVersion, date: currentPublishedAt })
          : t("statusUnpublished")}
      </p>

      <form action={formAction} className="flex flex-col gap-2 text-sm">
        <input type="hidden" name="kind" value={kind} />

        <Label htmlFor={`legal-title-${kind}`}>{t("documentTitle")}</Label>
        <Input
          id={`legal-title-${kind}`}
          name="title"
          required
          maxLength={LEGAL_TITLE_MAX_LENGTH}
          defaultValue={document?.title ?? t(`kind.${kind}`)}
          disabled={busy}
        />

        <Label htmlFor={`legal-locale-${kind}`}>{t("locale")}</Label>
        <PanelSelect
          id={`legal-locale-${kind}`}
          name="locale"
          defaultValue={document?.locale ?? "pl"}
          disabled={busy}
          options={[
            { value: "pl", label: t("localePl") },
            { value: "en", label: t("localeEn") },
          ]}
        />

        <Label htmlFor={`legal-body-${kind}`}>{t("body")}</Label>
        <Textarea
          id={`legal-body-${kind}`}
          name="body_draft"
          required
          maxLength={LEGAL_BODY_MAX_LENGTH}
          defaultValue={document?.bodyDraft ?? ""}
          disabled={busy}
          className="min-h-64"
        />

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button type="submit" loading={saving} disabled={busy}>
            {t("save")}
          </Button>
          <PublishDialog
            disabled={busy || !publishable}
            pending={publishing}
            documentName={t(`kind.${kind}`)}
            replacing={currentVersion != null}
            onConfirm={publish}
          />
          <SaveFeedback state={state} />
        </div>

        {publishable ? null : (
          <p className="text-muted-foreground text-[13px] leading-[18px]">{t("publishNeedsDraft")}</p>
        )}

        {publishFeedback ? <PublishFeedbackLine feedback={publishFeedback} /> : null}
      </form>

      <LegalVersionHistory versions={document?.versions ?? []} />
    </ScreenSection>
  );
}

function PublishFeedbackLine({ feedback }: { feedback: PublishFeedback }) {
  const t = useTranslations("legalDocuments");

  if (feedback.kind === "error")
    return (
      <p role="alert" className="text-destructive text-sm">
        {feedback.message}
      </p>
    );

  // Publikacja treści identycznej z żywą wersją NIE tworzy nowego wpisu
  // (0063). To jest POPRAWNY wynik i musi się tak czytać — komunikat błędu
  // kazałby najemcy szukać usterki tam, gdzie zadziałała reguła.
  if (feedback.kind === "unchanged")
    return (
      <p data-legal-publish-unchanged className="text-status-attention-fg text-sm">
        {t("publishUnchanged")}
      </p>
    );

  return (
    <p data-legal-publish-created className="text-status-positive-fg text-sm">
      {t("publishCreated", { version: feedback.version })}
    </p>
  );
}

/**
 * Potwierdzenie publikacji. Treść mówi o SKUTKU (co zobaczy klient i co
 * stanie się z rejestrem), a nie o czynności — i rozróżnia pierwszą
 * publikację od kolejnej, bo tylko przy kolejnej istnieje wersja, którą ta
 * zastępuje w sklepie.
 */
function PublishDialog({
  disabled,
  pending,
  documentName,
  replacing,
  onConfirm,
}: {
  disabled: boolean;
  pending: boolean;
  documentName: string;
  replacing: boolean;
  onConfirm: () => void;
}) {
  const t = useTranslations("legalDocuments");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          loading={pending}
          data-legal-publish
        >
          {t("publish")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("publishTitle", { document: documentName })}</DialogTitle>
          <DialogDescription>
            {replacing ? t("publishBodyReplace") : t("publishBodyFirst")}
          </DialogDescription>
        </DialogHeader>
        <p className="text-muted-foreground text-[13px] leading-[18px]">{t("publishNote")}</p>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary" disabled={pending}>
              {t("cancel")}
            </Button>
          </DialogClose>
          <DialogClose asChild>
            <Button type="button" data-legal-publish-confirm onClick={onConfirm}>
              {t("publish")}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
