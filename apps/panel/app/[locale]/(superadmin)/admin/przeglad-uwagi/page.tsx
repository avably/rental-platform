/**
 * Widok PM przeglądu produktu (ADR-071): wszystkie uwagi z OBU powierzchni,
 * do przejścia po kolei i naniesienia poprawek.
 *
 * Sort domyślny: priorytet rosnąco (1 = najpilniejsze na górze), w obrębie
 * priorytetu kolejność ekranu z listy 39, potem czas. Przełącznik ?sort=ekran
 * odwraca dwa pierwsze klucze — do pracy „ekran po ekranie".
 *
 * Istnieje wyłącznie przy REVIEW_MODE=1 (jak nakładka i endpointy) — poza
 * trybem przeglądu 404, jakby trasy nigdy nie było.
 */
import { notFound } from "next/navigation";

import { listComments, screenOrder, type ReviewCommentDto } from "@avably/review";

import { localePath } from "@/lib/navigation";
import { requireSuperadminPage } from "@/lib/superadmin";

import { toggleReviewStatusAction } from "./actions";

export const dynamic = "force-dynamic";

const SURFACE_LABEL: Record<ReviewCommentDto["surface"], string> = {
  panel: "Panel",
  marketing: "WWW",
  storefront: "Sklep",
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Warsaw",
  }).format(new Date(value));
}

function byPriority(a: ReviewCommentDto, b: ReviewCommentDto): number {
  return (
    a.priority - b.priority ||
    screenOrder(a.screen) - screenOrder(b.screen) ||
    a.created_at.localeCompare(b.created_at)
  );
}

function byScreen(a: ReviewCommentDto, b: ReviewCommentDto): number {
  return (
    screenOrder(a.screen) - screenOrder(b.screen) ||
    a.priority - b.priority ||
    a.created_at.localeCompare(b.created_at)
  );
}

/**
 * Link „otwórz na powierzchni": panel — względny z prefiksem locale;
 * marketing/sklep — bazy z env (dev: localhost:3001; sandbox: kanon www i
 * subdomena tenanta testowego). #rc-<id> każe nakładce wskoczyć do pinezki.
 */
async function surfaceHref(comment: ReviewCommentDto): Promise<string> {
  const hash = `#rc-${comment.id}`;
  if (comment.surface === "panel") {
    return (await localePath(comment.route, { review: "1" })) + hash;
  }
  const storefrontBase = (process.env.REVIEW_STOREFRONT_URL ?? "http://localhost:3001").replace(/\/$/, "");
  if (comment.surface === "marketing") {
    const route = comment.route === "/" ? "" : comment.route;
    return `${storefrontBase}/pl${route}?review=1${hash}`;
  }
  const tenantBase = (process.env.REVIEW_TENANT_URL ?? storefrontBase).replace(/\/$/, "");
  return `${tenantBase}${comment.route}?review=1${hash}`;
}

export default async function ReviewCommentsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  // Guard sesji PRZED kill-switchem — anonim dostaje to samo co na każdej
  // trasie /admin (przekierowanie na logowanie), a 404 z wyłączonego
  // REVIEW_MODE widzi dopiero uwierzytelniony superadmin.
  const ctx = await requireSuperadminPage("/admin/przeglad-uwagi");
  if (process.env.REVIEW_MODE !== "1") notFound();
  const { sort } = await searchParams;
  const byScreenSort = sort === "ekran";

  const comments = (await listComments(ctx.supabase)).sort(byScreenSort ? byScreen : byPriority);
  const open = comments.filter((comment) => comment.status === "open");
  const done = comments.filter((comment) => comment.status === "done");
  const openByPriority = new Map<number, number>();
  for (const comment of open) {
    openByPriority.set(comment.priority, (openByPriority.get(comment.priority) ?? 0) + 1);
  }

  const hrefs = new Map<string, string>();
  for (const comment of comments) hrefs.set(comment.id, await surfaceHref(comment));

  const chip =
    "inline-flex min-h-6 items-center rounded-full border px-2.5 text-xs font-semibold";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Przegląd — uwagi</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Uwagi właściciela z panelu, WWW i sklepu klienta. Otwarte:{" "}
            <strong className="text-foreground">{open.length}</strong> · rozwiązane:{" "}
            <strong className="text-foreground">{done.length}</strong>
            {open.length > 0 ? (
              <>
                {" · wg priorytetu: "}
                {[1, 2, 3, 4, 5]
                  .filter((priority) => openByPriority.has(priority))
                  .map((priority) => `P${priority}×${openByPriority.get(priority)}`)
                  .join(", ")}
              </>
            ) : null}
          </p>
        </div>
        <nav className="flex gap-2 text-sm" aria-label="Sortowanie">
          <a
            href="?"
            aria-current={!byScreenSort ? "page" : undefined}
            className={`${chip} ${!byScreenSort ? "border-foreground bg-accent text-accent-foreground" : "border-border text-muted-foreground"} min-h-11 items-center px-4 no-underline`}
          >
            wg priorytetu
          </a>
          <a
            href="?sort=ekran"
            aria-current={byScreenSort ? "page" : undefined}
            className={`${chip} ${byScreenSort ? "border-foreground bg-accent text-accent-foreground" : "border-border text-muted-foreground"} min-h-11 items-center px-4 no-underline`}
          >
            wg kolejności ekranu
          </a>
        </nav>
      </header>

      {comments.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-xl border border-dashed p-8 text-center text-sm">
          Jeszcze żadnych uwag. Wejdź na dowolny ekran z <code className="font-sans">?review=1</code>,
          przełącz na tryb Komentarz i klikaj.
        </p>
      ) : (
        <ul className="space-y-3">
          {comments.map((comment) => (
            <li
              key={comment.id}
              className={`border-border bg-card rounded-xl border p-4 ${comment.status === "done" ? "opacity-70" : ""}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`${chip} ${
                    comment.priority <= 2
                      ? "border-foreground bg-accent text-accent-foreground"
                      : "border-border text-muted-foreground"
                  }`}
                  title={`Priorytet ${comment.priority} (1 = najwyższy)`}
                >
                  P{comment.priority}
                </span>
                <span
                  className={`${chip} ${
                    comment.status === "open"
                      ? "border-[color:var(--signal-strong,#5F7500)] text-[color:var(--signal-strong,#5F7500)]"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {comment.status === "open" ? "otwarte" : "✓ rozwiązane"}
                </span>
                <span className={`${chip} border-border text-muted-foreground`}>
                  {SURFACE_LABEL[comment.surface]}
                </span>
                <span className="text-sm font-medium">{comment.screen}</span>
                <span className="text-muted-foreground text-xs">
                  {comment.route} · {comment.kind === "area" ? "obszar" : "punkt"} ·{" "}
                  {formatDate(comment.created_at)}
                </span>
              </div>
              <p className="mt-2 text-sm break-words whitespace-pre-wrap">{comment.body}</p>
              {comment.attachments.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {comment.attachments.map((attachment) => (
                    // Signed URL wygasa — miniatura jest podglądem roboczym,
                    // nie trwałym zasobem; pełny rozmiar w nowej karcie.
                    <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={attachment.url}
                        alt="Załącznik uwagi"
                        className="border-border h-16 w-16 rounded-lg border object-cover"
                      />
                    </a>
                  ))}
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <a
                  href={hrefs.get(comment.id)}
                  className="border-border inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-medium no-underline hover:underline"
                >
                  Otwórz na powierzchni ↗
                </a>
                <form action={toggleReviewStatusAction}>
                  <input type="hidden" name="id" value={comment.id} />
                  <input
                    type="hidden"
                    name="status"
                    value={comment.status === "open" ? "done" : "open"}
                  />
                  <button
                    type="submit"
                    className="border-border inline-flex min-h-9 cursor-pointer items-center rounded-md border px-3 text-sm font-medium hover:underline"
                  >
                    {comment.status === "open" ? "Oznacz rozwiązane" : "Otwórz ponownie"}
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
