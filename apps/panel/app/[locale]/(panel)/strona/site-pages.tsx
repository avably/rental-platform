"use client";

/**
 * LISTA STRON SKLEPU (0048, ADR-093; znaczenie po fazie 2 — 0073/ADR-157) —
 * ekran, który zastąpił launcher.
 *
 * Do 0072 wiersz `sites` był WERSJĄ jednej strony i lista odpowiadała na
 * pytanie „którą wersję widzi klient". Od 0073 wiersze są osobnymi STRONAMI,
 * a od 0074 publikacja jednej NIE GASI pozostałych — więc lista odpowiada
 * odtąd na pytanie „co stoi w sklepie i pod jakim adresem". Formularzy tu nie
 * ma: treść składa się na płótnie kreatora.
 *
 * DWIE RZECZY, KTÓRE MUSZĄ BYĆ WIDOCZNE OD RAZU, bo bez nich lista kłamie:
 *
 *   1. Które strony są ŻYWE. Chip osi `site-publish` dostaje KAŻDA z nich —
 *      po fazie 2 może ich być wiele; strony robocze dostają zdanie, a nie
 *      chip udający stan spoza mapy (zasada z launchera sprzed 0048).
 *   2. Że żywej strony NIE DA SIĘ usunąć. Przycisk jest wyłączony i mówi, co
 *      zrobić — tym samym zdaniem, którym odmawia trigger w bazie. Interfejs,
 *      który pozwala kliknąć i dopiero potem tłumaczy odmowę, uczy operatora,
 *      że komunikaty błędów są normalną częścią pracy.
 *
 * Publikacja i usunięcie mają POTWIERDZENIE, bo obie zmieniają coś, czego
 * operator nie widzi z tego ekranu: publikacja wystawia stronę klientom pod
 * jej adresem, usunięcie kasuje treść bez kosza.
 */
import {
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
} from "@avably/ui";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { HOME_PAGE_SLUG, pagePathFromSlug, suggestPageSlug } from "@avably/core/site";

import { PublishDialog } from "@/components/publish-dialog";
import { Link } from "@/i18n/navigation";
import { createSite, deleteSite, publishSite, renameSite } from "@/lib/actions/site";
import { SecondaryStatusChip } from "@/lib/secondary-status";
import { MAX_SITES, pageSlugIssue } from "@/lib/site-validation";

export interface SitePageRow {
  id: string;
  name: string;
  /** Czy TĘ stronę widzi klient. Jedyna prawda o żywości (ADR-093 D1). */
  live: boolean;
  /** ADRES SZKICU (0073): pusty = strona główna (`/`). */
  slug: string;
  /** ADRES OPUBLIKOWANY; null = strona nigdy nie opublikowana. */
  slugPublished: string | null;
  /** Czy stary adres dostanie 308 przy najbliższej publikacji (0075). */
  redirectOldSlug: boolean;
  publishedAtLabel: string | null;
  createdAtLabel: string | null;
}

export function SitePages({ rows }: { rows: SitePageRow[] }) {
  const t = useTranslations("site");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error);
    });
  }

  const limitReached = rows.length >= MAX_SITES;

  return (
    <div className="flex flex-col gap-6" data-site-pages>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-muted-foreground text-sm">{t("pages.subtitle")}</p>
        <NewPageDialog
          disabled={pending || limitReached}
          onCreate={(name, slug) => run(() => createSite({ name, slug }))}
        />
      </div>

      {limitReached ? (
        <p className="text-muted-foreground text-[13px] leading-[18px]">
          {t("pages.limitReached", { max: MAX_SITES })}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <div data-site-pages-empty className="border-border flex flex-col items-start gap-3 rounded-lg border p-6">
          <p className="text-sm font-medium">{t("pages.emptyTitle")}</p>
          <p className="text-muted-foreground text-[13px] leading-[18px]">{t("pages.emptyBody")}</p>
        </div>
      ) : (
        <ul className="flex list-none flex-col gap-3 p-0">
          {rows.map((row) => (
            <li
              key={row.id}
              data-site-page={row.id}
              data-site-page-live={row.live ? "on" : "off"}
              /*
               * Kotwica z mockupu fazy 2 (`data-publish-status`) PRZENOSI SIĘ
               * z launchera na WIERSZ listy: stan publikacji przestał być
               * własnością ekranu, a stał się własnością wersji strony.
               * Kontrakt spójności ekranów dalej ją znajduje.
               */
              data-publish-status
              className="border-border flex flex-col gap-3 rounded-lg border p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{row.name}</span>
                {row.live ? (
                  <SecondaryStatusChip axis="site-publish" value="published" />
                ) : (
                  <span className="text-muted-foreground text-[13px] leading-[18px]">
                    {t("pages.statusDraft")}
                  </span>
                )}
              </div>

              {/*
                STRONA GŁÓWNA JEST PODPISANA (ADR-161). Sam adres `/` jest
                poprawny i jednocześnie nieczytelny: to jedyny wiersz listy,
                którego adres nie mówi, czym ta strona jest — „kontakt"
                i „o-nas" mówią to same. Podpis stoi OBOK adresu, a nie zamiast
                niego, bo adres strony głównej też jest informacją (operator
                pyta o niego przy przekierowaniach i w sitemapie).
              */}
              <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-[13px] leading-[18px]">
                <span className="font-mono">{pagePathFromSlug(row.slug)}</span>
                {row.slug === HOME_PAGE_SLUG ? (
                  <span
                    data-site-page-home
                    className="border-border text-foreground rounded-full border px-2 py-0.5 text-[12px] leading-[16px]"
                  >
                    {t("pages.homeBadge")}
                  </span>
                ) : null}
              </p>

              {/*
                ADRES ZMIENIONY, ALE JESZCZE NIEOPUBLIKOWANY. Bez tego zdania
                operator zmienia adres, widzi go na liście i jest przekonany,
                że klienci już go mają — a żywy adres zmienia WYŁĄCZNIE
                publikacja (bliźniak `slug_published`, 0073/ADR-091).
              */}
              {row.slugPublished !== null && row.slugPublished !== row.slug ? (
                <p className="text-muted-foreground text-[13px] leading-[18px]">
                  {t("pages.addressPending", { current: pagePathFromSlug(row.slugPublished) })}
                </p>
              ) : null}

              <p className="text-muted-foreground text-[13px] leading-[18px]">
                {row.live && row.publishedAtLabel
                  ? t("pages.publishedAt", { date: row.publishedAtLabel })
                  : /*
                     * Zdanie o wersji roboczej mówi o TERAŹNIEJSZOŚCI, a nie
                     * o historii — i to jest poprawka znaleziona na weryfikacji
                     * przeglądarkowej. Dotychczasowe `publish.notPublished`
                     * („strona nie była jeszcze publikowana") jest po 0048
                     * FAŁSZEM dla wersji, która była w sklepie i została
                     * zastąpiona: `published_at` zdejmujemy przy przełączeniu
                     * (świadomy koszt D1), więc historii z tej kolumny już nie
                     * odczytamy. Zdanie o stanie bieżącym jest prawdziwe zawsze.
                     */
                    t("pages.notLive")}
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <Button asChild type="button" size="sm">
                  <Link href={`/strona/${row.id}/kreator`} data-open-builder={row.id}>
                    {t("builder.open")}
                  </Link>
                </Button>

                {/*
                  * Publikacja stoi przy KAŻDEJ stronie, także przy żywej, i to
                  * nie jest przeoczenie: dla roboczej znaczy „wystaw ją pod jej
                  * adresem", a dla żywej — „wypuść do klientów zmiany, które
                  * w niej zrobiłem". To drugie jest podstawowym obiegiem od K5a.
                  * Różnicę niesie treść potwierdzenia, nie obecność przycisku.
                  *
                  * Stało tu wyszukanie „która INNA strona jest żywa" (ADR-165):
                  * dialog mówił z niego, że dotychczasowa strona przestanie być
                  * publiczna. Od 0074 nie przestaje — więc wyszukanie zniknęło,
                  * a jego miejsce zajął ADRES tej strony.
                  */}
                <PublishDialog
                  disabled={pending}
                  live={row.live}
                  name={row.name}
                  address={pagePathFromSlug(row.slug)}
                  onConfirm={() => run(() => publishSite(row.id))}
                />

                <RenameDialog
                  disabled={pending}
                  current={row.name}
                  currentSlug={row.slug}
                  publishedSlug={row.slugPublished}
                  redirectOldSlug={row.redirectOldSlug}
                  onRename={(name, slug, redirect) =>
                    run(() =>
                      renameSite({
                        siteId: row.id,
                        name,
                        ...(slug === undefined ? {} : { slug }),
                        ...(redirect === undefined ? {} : { redirectOldSlug: redirect }),
                      }),
                    )
                  }
                />

                {row.live ? (
                  <Button type="button" size="sm" variant="ghost" disabled data-delete-site-blocked={row.id}>
                    {t("pages.deleteBlocked")}
                  </Button>
                ) : (
                  <DeleteDialog
                    disabled={pending}
                    name={row.name}
                    onConfirm={() => run(() => deleteSite(row.id))}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * POLE ADRESU — jedno miejsce na podpowiedź z nazwy, walidację i uzasadnienie.
 *
 * Odmowa pada W POLU, zanim cokolwiek zostanie wysłane, i mówi CO poprawić:
 * strona o adresie `koszyk` czy `regulamin` nie wyświetliłaby się NIGDY —
 * statyczna trasa zawsze wygrywa z dynamiczną — a operator widziałby ją
 * w panelu jako opublikowaną i nie dostałby ani jednego sygnału.
 */
function SlugField({
  value,
  onChange,
  disabled,
  hint,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  hint: string;
}) {
  const t = useTranslations("site");
  const issue = disabled ? null : pageSlugIssue(value);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground font-mono text-[13px] leading-[18px]">/</span>
        <Input
          value={value}
          maxLength={60}
          disabled={disabled}
          className="font-mono"
          aria-label={t("pages.slugLabel")}
          aria-invalid={issue ? true : undefined}
          data-site-slug-input
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      <p className="text-muted-foreground text-[13px] leading-[18px]">{hint}</p>
      {issue ? (
        <p role="alert" data-site-slug-error className="text-destructive text-[13px] leading-[18px] font-medium">
          {issue}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Nowa strona — nazwa I ADRES od razu (Faza 2, ADR-158).
 *
 * Adres podpowiada się z nazwy DOPÓKI operator go nie tknie (wzorzec formularza
 * kategorii, ADR-155): dalsze przepisywanie po ręcznej zmianie kasowałoby jego
 * pracę przy każdym znaku nazwy.
 */
function NewPageDialog({
  disabled,
  onCreate,
}: {
  disabled: boolean;
  onCreate: (name: string, slug: string) => void;
}) {
  const t = useTranslations("site");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  const blocked = name.trim().length === 0 || pageSlugIssue(slug) !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setName("");
          setSlug("");
          setSlugTouched(false);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" disabled={disabled} data-new-site>
          <Plus className="size-4" aria-hidden />
          {t("pages.new")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("pages.newTitle")}</DialogTitle>
          <DialogDescription>{t("pages.newBody")}</DialogDescription>
        </DialogHeader>
        <Input
          value={name}
          maxLength={80}
          placeholder={t("pages.defaultName")}
          aria-label={t("pages.nameLabel")}
          onChange={(event) => {
            setName(event.target.value);
            if (!slugTouched) setSlug(suggestPageSlug(event.target.value));
          }}
        />
        <SlugField
          value={slug}
          hint={t("pages.slugHint")}
          onChange={(next) => {
            setSlugTouched(true);
            setSlug(next);
          }}
        />
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              {t("pages.cancel")}
            </Button>
          </DialogClose>
          <Button
            type="button"
            data-new-site-confirm
            disabled={blocked}
            onClick={() => {
              onCreate(name.trim(), slug.trim());
              setOpen(false);
            }}
          >
            {t("pages.newConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * NAZWA I ADRES w JEDNYM oknie (Faza 2, ADR-158).
 *
 * Adres jest daną publiczną, więc zmienia się WYŁĄCZNIE publikacją — zapis
 * z tego okna idzie do kolumny szkicu. To jest zarazem jedyne miejsce, w którym
 * operator zmienia adres, czyli jedyne, w którym trzeba go zapytać o los
 * starego adresu (ADR-159, checkbox przekierowania).
 *
 * STRONA GŁÓWNA MA POLE ADRESU WYŁĄCZONE, a nie ukryte: jej adresem jest `/`
 * i to jest informacja, nie brak funkcji. Ukrycie pola kazałoby operatorowi
 * zgadywać, czy strona główna w ogóle ma adres.
 */
function RenameDialog({
  disabled,
  current,
  currentSlug,
  publishedSlug,
  redirectOldSlug,
  onRename,
}: {
  disabled: boolean;
  current: string;
  currentSlug: string;
  publishedSlug: string | null;
  redirectOldSlug: boolean;
  onRename: (name: string, slug: string | undefined, redirect: boolean | undefined) => void;
}) {
  const t = useTranslations("site");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(current);
  const [slug, setSlug] = useState(currentSlug);
  const [redirect, setRedirect] = useState(redirectOldSlug);
  const isHome = currentSlug === HOME_PAGE_SLUG;

  /*
    PYTANIE O STARY ADRES PADA TAM, GDZIE ZMIENIA SIĘ ADRES (ADR-159).
    Widoczne wyłącznie wtedy, gdy stary adres NAPRAWDĘ istnieje — strona nigdy
    nieopublikowana nie ma czego przekierowywać, a checkbox bez konsekwencji
    uczy operatora, że opcje w tym oknie nic nie znaczą.
  */
  const zmienionyAdres =
    !isHome && publishedSlug !== null && publishedSlug !== "" && slug.trim() !== publishedSlug;

  const blocked = name.trim().length === 0 || (!isHome && pageSlugIssue(slug) !== null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setName(current);
          setSlug(currentSlug);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="ghost" disabled={disabled} data-rename-site>
          {t("pages.rename")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("pages.renameTitle")}</DialogTitle>
        </DialogHeader>
        <Input
          value={name}
          maxLength={80}
          aria-label={t("pages.nameLabel")}
          onChange={(event) => setName(event.target.value)}
        />
        <SlugField
          value={slug}
          disabled={isHome}
          hint={isHome ? t("pages.slugHome") : t("pages.slugChangeHint")}
          onChange={setSlug}
        />
        {zmienionyAdres ? (
          <label className="flex items-start gap-2 text-[13px] leading-[18px]">
            <Checkbox
              checked={redirect}
              data-redirect-old-slug
              onCheckedChange={(next) => setRedirect(next === true)}
            />
            <span>
              {t("pages.redirectOld", { old: pagePathFromSlug(publishedSlug ?? "") })}
              <span className="text-muted-foreground block">{t("pages.redirectOldHint")}</span>
            </span>
          </label>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              {t("pages.cancel")}
            </Button>
          </DialogClose>
          <Button
            type="button"
            data-rename-site-confirm
            disabled={blocked}
            onClick={() => {
              onRename(
                name.trim(),
                isHome ? undefined : slug.trim(),
                zmienionyAdres ? redirect : undefined,
              );
              setOpen(false);
            }}
          >
            {t("pages.renameConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Potwierdzenie usunięcia. Zdanie „klienci nigdy jej nie widzieli, więc
 * w sklepie nic się nie zmieni" jest PRAWDZIWE dokładnie dlatego, że żywej
 * wersji usunąć się nie da (trigger 0048) — gdyby dało, byłoby kłamstwem.
 */
function DeleteDialog({
  disabled,
  name,
  onConfirm,
}: {
  disabled: boolean;
  name: string;
  onConfirm: () => void;
}) {
  const t = useTranslations("site");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="ghost" disabled={disabled} data-delete-site>
          {t("pages.delete")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("pages.deleteTitle", { name })}</DialogTitle>
          <DialogDescription>{t("pages.deleteBody")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              {t("pages.cancel")}
            </Button>
          </DialogClose>
          <DialogClose asChild>
            <Button type="button" variant="destructive" data-delete-site-confirm onClick={onConfirm}>
              {t("pages.deleteConfirm")}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
