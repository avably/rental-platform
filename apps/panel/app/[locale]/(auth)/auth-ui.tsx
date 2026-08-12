import { Button, Input, Label } from "@avably/ui";
import { CircleAlert, CircleCheck, Info } from "lucide-react";

/**
 * Części prezentacyjne ekranów wejścia (ADR-156).
 *
 * Pięć ekranów `(auth)` powstawało osobno i wyglądało jak pięć produktów:
 * jeden miał tytuł `text-xl`, drugi wyśrodkowany akapit, trzeci własną
 * czerwień `text-red-600` zamiast tokenu. Tu mieszka jedno brzmienie tych
 * elementów — ekran wybiera części, a nie pisze klas.
 *
 * NIC W TYM PLIKU NIE DECYDUJE O NICZYM. To jest warstwa widoku: żadna z tych
 * funkcji nie czyta sesji, nie klasyfikuje błędu i nie wie, czy konto
 * istnieje. Komunikat dostaje gotowy tekst od akcji serwerowej i pokazuje go
 * bez rozgałęzień — jednolitość odmów (ADR-153) zostaje tam, gdzie była.
 */

/**
 * Nagłówek ekranu: tytuł nazywa rezultat, podtytuł mówi, co się stanie.
 *
 * Tytuł idzie PRZEZ `children`, nie przez prop — świadomie. Testy ekranów
 * `(auth)` chodzą po drzewie elementów Server Componentu i zbierają teksty
 * wyłącznie z `props.children`; tytuł podany propem byłby dla nich niewidoczny
 * i bramka „ekran w ogóle się wyrenderował" przestałaby cokolwiek mierzyć.
 */
export function AuthHeading({
  subtitle,
  children,
}: {
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h1 className="text-[1.75rem] leading-[2.125rem] font-semibold tracking-[-0.02em]">
        {children}
      </h1>
      {subtitle ? <p className="text-muted-foreground mt-2 text-[0.9375rem]">{subtitle}</p> : null}
    </div>
  );
}

/**
 * Pole formularza: etykieta w jednym wierszu z dodatkiem (np. „Nie pamiętam
 * hasła" przy haśle), pod spodem kontrolka, pod nią podpowiedź.
 *
 * `htmlFor`/`id` są WYMAGANE: dotąd etykieta owijała `<input>`, co działa, ale
 * nie pozwala postawić obok niej niczego innego — a to właśnie miejsce, w
 * którym powinien stać odnośnik do resetu hasła.
 */
export function AuthField({
  id,
  label,
  aux,
  hint,
  children,
}: {
  id: string;
  label: string;
  aux?: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {aux ?? null}
      </div>
      {children}
      {hint ? (
        <p className="text-muted-foreground text-[0.8125rem] leading-[18px]">{hint}</p>
      ) : null}
    </div>
  );
}

/** Kontrolka tekstowa ekranów wejścia — 44 px wysokości, jak w makiecie. */
export function AuthInput(props: React.ComponentProps<typeof Input>) {
  return <Input {...props} className="h-11" />;
}

const NOTICE_TONES = {
  problem: {
    box: "bg-status-problem-bg text-status-problem-fg border-status-problem-border",
    Icon: CircleAlert,
  },
  positive: {
    box: "bg-status-positive-bg text-status-positive-fg border-status-positive-border",
    Icon: CircleCheck,
  },
  attention: {
    box: "bg-status-attention-bg text-status-attention-fg border-status-attention-border",
    Icon: Info,
  },
} as const;

export type AuthNoticeTone = keyof typeof NOTICE_TONES;

/**
 * Komunikat ekranu — jedno pudełko na wszystkie trzy tony.
 *
 * `role` przychodzi z zewnątrz, bo różnica jest funkcjonalna: `alert` przerywa
 * czytnikowi bieżącą wypowiedź (coś poszło nie tak), `status` czeka na przerwę
 * (potwierdzenie). Domyślnie `status`, żeby żaden ekran nie krzyczał
 * przypadkiem.
 */
export function AuthNotice({
  tone,
  description,
  actions,
  role = "status",
  children,
  ...rest
}: {
  tone: AuthNoticeTone;
  /** Zdanie drugiego planu pod komunikatem głównym. */
  description?: React.ReactNode;
  /** Drogi wyjścia obok komunikatu (odnośniki). */
  actions?: React.ReactNode;
  role?: "alert" | "status";
  children: React.ReactNode;
} & Omit<React.ComponentProps<"div">, "children" | "role">) {
  const { box, Icon } = NOTICE_TONES[tone];

  return (
    <div className={`flex gap-2.5 rounded-md border px-3.5 py-3 ${box}`} role={role} {...rest}>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <p className="text-sm leading-5 font-medium">{children}</p>
        {description ? (
          <p className="mt-1 text-[0.8125rem] leading-[19px] opacity-90">{description}</p>
        ) : null}
        {actions ? (
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-[0.8125rem] font-semibold">
            {actions}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * MIEJSCE NA CAPTCHĘ — rezerwacja mieszka TUTAJ, nie w komponencie widżetu.
 *
 * Dwa powody, oba sprawdzone na żywym ekranie:
 *
 * 1. WYŚRODKOWANIE. Turnstile rysuje iframe o STAŁEJ szerokości 300 px, więc
 *    `text-align: center` na rodzicu nie robi nic — iframe to element blokowy
 *    o własnej szerokości, a nie tekst. Slot jest kontenerem flex z
 *    `justify-center`: dziecko dostaje szerokość swojej treści (300 px) i
 *    ląduje na osi kolumny. Kolumna ma 416 px, więc bez tego widżet stałby
 *    58 px w lewo od osi pól — i to widać.
 * 2. GEOMETRIA NIEZALEŻNA OD ŚRODOWISKA. `AuthCaptchaField` zwraca `null` bez
 *    site key (anty-lockout, ADR-106), więc rezerwacja schowana w środku
 *    widżetu znikałaby razem z nim: ekran bez skonfigurowanego klucza miałby
 *    inny układ niż produkcja, a przycisk skakałby w chwili doładowania
 *    widżetu. Slot stoi w formularzu i trzyma 72 px zawsze.
 *
 * NIE JEST TO BRAMKA BEZPIECZEŃSTWA i nie wolno jej za taką brać: o tym, czy
 * CAPTCHA obowiązuje, decyduje WYŁĄCZNIE weryfikacja po stronie serwera
 * (`verifyTurnstile` w akcjach). Ten div niczego nie włącza ani nie wyłącza.
 */
export function AuthCaptchaSlot({ children }: { children: React.ReactNode }) {
  return (
    <div data-auth-captcha-slot className="flex min-h-18 w-full items-center justify-center">
      {children}
    </div>
  );
}

/** Przycisk główny ekranu — jeden na formularz, pełna szerokość kolumny. */
export function AuthSubmit({
  pending,
  variant = "default",
  children,
}: {
  pending?: boolean;
  variant?: "default" | "outline";
  children: React.ReactNode;
}) {
  return (
    <Button
      type="submit"
      variant={variant}
      size="lg"
      aria-busy={pending || undefined}
      disabled={pending}
      className="h-12 w-full text-[0.9375rem]"
    >
      {children}
    </Button>
  );
}

/**
 * Odnośniki pod formularzem — KOLUMNA, nie wiersz.
 *
 * Poprzedni układ (`flex justify-between` w jednym akapicie) rozjeżdżał się
 * razem z szerokością kolumny: gdy kolumna była wąska, „Załóż konto" i „Nie
 * pamiętam hasła" stykały się bez odstępu i czytały się jak jeden odnośnik.
 * Kolumna z odstępem nie ma jak się skleić przy żadnej szerokości ani przy
 * żadnej długości tłumaczenia.
 */
export function AuthLinks({ children }: { children: React.ReactNode }) {
  return (
    <div data-auth-links className="text-muted-foreground flex flex-col gap-2 text-sm">
      {children}
    </div>
  );
}
