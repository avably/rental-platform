"use client";

import {
  Badge,
  Button,
  Calendar,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  FileField,
  FilterChip,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Separator,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  StatusBadge,
  statusSemantics,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  dayPickerLocale,
} from "@avably/ui";
import { useLocale } from "next-intl";
import { useState, type ReactNode } from "react";

import { BrandLoader } from "@/components/shell/brand-loader";

// Etykiety PL statusów zamówienia jak w sekcji 04 artefaktu — sam rodzaj
// semantyczny pochodzi WYŁĄCZNIE z mapy statusSemantics (jedno źródło prawdy).
const orderStatusLabels: Record<keyof typeof statusSemantics.order, string> = {
  pending: "Oczekuje",
  reserved: "Zarezerwowane",
  ready_for_pickup: "Do odbioru",
  picked_up: "Wydane",
  returned: "Zwrócone",
  cancelled: "Anulowane",
};

const colorTokens = [
  { name: "background", className: "bg-background" },
  { name: "foreground", className: "bg-foreground" },
  { name: "card", className: "bg-card" },
  { name: "primary", className: "bg-primary" },
  { name: "secondary", className: "bg-secondary" },
  { name: "muted", className: "bg-muted" },
  { name: "accent", className: "bg-accent" },
  { name: "destructive", className: "bg-destructive" },
  { name: "border", className: "bg-border" },
  { name: "ring", className: "bg-ring" },
] as const;

function GallerySection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-5" aria-labelledby={id}>
      <div className="space-y-1">
        <h2 id={id} className="text-xl font-semibold tracking-tight">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

export default function DesignSystemGallery() {
  const locale = useLocale();
  const [darkMode, setDarkMode] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    new Date(2026, 6, 14),
  );
  const [notifications, setNotifications] = useState(true);
  const [density, setDensity] = useState("wygodna");

  return (
    <main
      className={
        darkMode
          ? "dark min-h-screen bg-background"
          : "min-h-screen bg-background"
      }
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-14 px-4 py-8 text-foreground sm:px-6 sm:py-12 lg:px-8">
        <header className="flex flex-col gap-6 border-b pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl space-y-3">
            <Badge variant="outline">@avably/ui</Badge>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Galeria design systemu
            </h1>
            <p className="text-pretty text-muted-foreground">
              Kontrakt wizualny tokenów i prymitywów. Każdy przykład korzysta
              wyłącznie z publicznego interfejsu pakietu.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            aria-pressed={darkMode}
            onClick={() => setDarkMode((current) => !current)}
          >
            {darkMode ? "Włącz jasny motyw" : "Włącz ciemny motyw"}
          </Button>
        </header>

        <GallerySection
          id="tokens"
          title="Tokeny"
          description="Semantyczne kolory OKLCH zmieniają się razem z motywem."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {colorTokens.map((token) => (
              <div key={token.name} className="rounded-md border bg-card p-3">
                <div
                  className={`h-16 rounded-sm border ${token.className}`}
                  aria-hidden="true"
                />
                <code className="mt-2 block font-sans text-xs text-muted-foreground">
                  {token.name}
                </code>
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["sm", "rounded-sm"],
              ["md", "rounded-md"],
              ["lg", "rounded-lg"],
              ["xl", "rounded-xl"],
            ].map(([name, radius]) => (
              <div
                key={name}
                className={`${radius} border bg-card p-5 text-sm`}
              >
                radius-{name}
              </div>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-md border bg-popover p-5">
              <p className="font-medium">Nakładka</p>
              <p className="text-xs text-muted-foreground">
                Rozdział powierzchni robi obrys, nie cień - elewacji w systemie
                nie ma.
              </p>
            </div>
            <div className="rounded-md border bg-card p-5">
              <p className="font-medium">Karta</p>
              <p className="text-xs text-muted-foreground">
                Płaska powierzchnia na canvas, obrys w kolorze border.
              </p>
            </div>
          </div>
        </GallerySection>

        <Separator />

        <GallerySection
          id="typography"
          title="Typografia"
          description="Geist Sans w całym panelu - mono zakazane, identyfikatory przez tabular-nums."
        >
          <Card>
            <CardContent className="space-y-4 pt-6">
              <p className="text-3xl font-semibold tracking-tight">
                Nagłówek interfejsu
              </p>
              <p className="max-w-2xl text-base">
                Czytelny tekst podstawowy dla panelu i publicznego storefrontu.
              </p>
              <p className="text-sm text-muted-foreground">
                Tekst pomocniczy zachowuje kontrast WCAG AA w obu motywach.
              </p>
              <code className="block font-sans tabular-nums text-sm">REZ/2026/0714</code>
            </CardContent>
          </Card>
        </GallerySection>

        <GallerySection
          id="buttons-badges"
          title="Button i Badge"
          description="Warianty i rozmiary. Hover podkreśla, focus obrysowuje na limonce, active dociska o 1 px."
        >
          <div className="flex flex-wrap items-center gap-3">
            <Button>Podstawowy</Button>
            <Button variant="secondary">Drugorzędny</Button>
            <Button variant="outline">Obrys</Button>
            <Button variant="ghost">Dyskretny</Button>
            <Button variant="link">Odnośnik</Button>
            <Button variant="destructive">Usuń</Button>
            <Button disabled>Nieaktywny</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm">Mały</Button>
            <Button>Domyślny</Button>
            <Button size="lg">Duży</Button>
            <Button size="icon" aria-label="Dodaj">
              +
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>Aktywna</Badge>
            <Badge variant="secondary">Szkic</Badge>
            <Badge variant="outline">Oczekuje</Badge>
            <Badge variant="destructive">Anulowana</Badge>
          </div>
        </GallerySection>

        <GallerySection
          id="states"
          title="Stany komponentów"
          description="Sekcja 07 artefaktu: disabled kreskuje obrys, loading dokłada wielokropek i cursor progress, filtr wciśnięty przechodzi na limonkę z nośnikiem ink, wiersz aktywny dostaje znacznik signal-strong. Hover, focus i active wypróbujesz interakcją."
        >
          <div className="flex flex-wrap items-center gap-3">
            <Button>Zapisz</Button>
            <Button disabled>Zapisz</Button>
            <Button loading>Zapisz</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary">Anuluj</Button>
            <Button variant="secondary" disabled>
              Anuluj
            </Button>
            <Button variant="secondary" loading>
              Anuluj
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="destructive">Usuń trwale</Button>
            <Button variant="destructive" disabled>
              Usuń trwale
            </Button>
            <Button variant="destructive" loading>
              Usuń trwale
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <FilterChip pressed={false}>Filtr</FilterChip>
            <FilterChip pressed>Filtr aktywny</FilterChip>
            <FilterChip pressed={false} disabled>
              Filtr zablokowany
            </FilterChip>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="states-error">Nazwa produktu</Label>
              <Input id="states-error" defaultValue="Na" aria-invalid />
              <p className="text-xs text-destructive">Zbyt krótka nazwa.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="states-valid">Nazwa produktu</Label>
              <Input id="states-valid" defaultValue="✓ Nagrzewnica 20 kW" />
              <p className="text-xs text-muted-foreground">
                Pole poprawne zostaje przy obrysie border - potwierdza znak, nie
                kolor.
              </p>
            </div>
          </div>
        </GallerySection>

        <GallerySection
          id="brand-loader"
          title="Loader marki Avably"
          description="Rozpoznawalny wskaźnik wyłącznie dla rzeczywistego oczekiwania — nie dla pustych wyników ani braku danych."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex min-h-56 items-center justify-center rounded-md border bg-card p-6">
              <BrandLoader label="Ładowanie panelu…" variant="full" showLabel />
            </div>
            <div className="flex min-h-56 items-center justify-center rounded-md border bg-card p-6">
              <BrandLoader label="Przekierowujemy…" variant="compact" showLabel />
            </div>
          </div>
          <div className="grid gap-3 text-sm text-muted-foreground md:grid-cols-3">
            <p className="rounded-md border p-4">
              Pełny wariant służy do ładowania tras i dużych regionów panelu.
            </p>
            <p className="rounded-md border p-4">
              Compact pojawia się tylko przy dłuższych operacjach blokujących.
            </p>
            <p className="rounded-md border p-4">
              Próg 200 ms zapobiega migotaniu. Przy <code>prefers-reduced-motion</code>
              {" "}pozostaje statyczny stan końcowy bez pętli.
            </p>
          </div>
        </GallerySection>

        <GallerySection
          id="file-upload"
          title="Pole wgrywania pliku"
          description="Ukryty, ale fokusowalny input pod ostylowaną strefą - klik i przeciągnięcie kończą się w tym samym natywnym inpucie (źródło prawdy dla FormData). Stany: pusty, błąd, wyłączone poniżej; wybrany i drag-over wypróbujesz interakcją."
        >
          <div className="grid gap-5 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="ds-file-empty">Plik zdjęcia</Label>
              <FileField
                id="ds-file-empty"
                name="ds-file-empty"
                accept="image/jpeg,image/png,image/webp,image/avif"
                prompt="Przeciągnij plik albo kliknij, aby wybrać"
                hint="Formaty: JPEG, PNG, WebP, AVIF. Maksymalnie 5 MB."
                removeLabel="Usuń wybrany plik"
                locale="pl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ds-file-error">Plik faktury (PDF)</Label>
              <FileField
                id="ds-file-error"
                name="ds-file-error"
                accept="application/pdf"
                prompt="Przeciągnij plik albo kliknij, aby wybrać"
                hint="Tylko PDF, najwyżej 8 MB."
                removeLabel="Usuń wybrany plik"
                error="Faktura musi być plikiem PDF."
                locale="pl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ds-file-disabled">Plik zdjęcia</Label>
              <FileField
                id="ds-file-disabled"
                name="ds-file-disabled"
                prompt="Wgrywanie zablokowane"
                hint="Wygaszenie kontrastu + kursor not-allowed."
                removeLabel="Usuń wybrany plik"
                disabled
                locale="pl"
              />
            </div>
          </div>
        </GallerySection>

        <GallerySection
          id="status-badges"
          title="Statusy domenowe"
          description="Cztery rodzaje semantyczne z artefaktu; status zawsze niesie tekst konkretnej wartości. Mapowanie osi domenowych na rodzaje pochodzi z eksportowanej stałej statusSemantics."
        >
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone="neutral">Zarezerwowane</StatusBadge>
            <StatusBadge tone="attention">Nieopłacone</StatusBadge>
            <StatusBadge tone="positive">Opłacone</StatusBadge>
            <StatusBadge tone="problem">Anulowane</StatusBadge>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">
              Oś zamówienia przez statusSemantics
            </p>
            <div className="flex flex-wrap gap-2">
              {(
                Object.keys(statusSemantics.order) as Array<
                  keyof typeof statusSemantics.order
                >
              ).map((status) => (
                <StatusBadge key={status} tone={statusSemantics.order[status]}>
                  {orderStatusLabels[status]}
                </StatusBadge>
              ))}
            </div>
          </div>
        </GallerySection>

        <GallerySection
          id="forms"
          title="Formularze"
          description="Pola podstawowe, błędne, wyłączone oraz wybór logiczny."
        >
          <Card>
            <CardContent className="grid gap-5 pt-6 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="gallery-name">Nazwa klienta</Label>
                <Input id="gallery-name" placeholder="Anna Kowalska" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gallery-email">Adres e-mail</Label>
                <Input
                  id="gallery-email"
                  type="email"
                  defaultValue="niepoprawny-adres"
                  aria-invalid
                />
                <p className="text-xs text-destructive">
                  Podaj poprawny adres e-mail.
                </p>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="gallery-notes">Uwagi</Label>
                <Textarea
                  id="gallery-notes"
                  placeholder="Informacje dla zespołu…"
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="gallery-active" defaultChecked />
                <Label htmlFor="gallery-active">Rezerwacja aktywna</Label>
              </div>
              <Input disabled value="Pole nieaktywne" readOnly />
            </CardContent>
          </Card>
        </GallerySection>

        <GallerySection
          id="cards-tables"
          title="Card i Table"
          description="Płaskie powierzchnie z obrysem. Hover wiersza zagęszcza obrys dolny; wiersz aktywny niesie znacznik przy lewej krawędzi."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Rezerwacje w toku</CardTitle>
                <CardDescription>Stan na dzisiaj, 14 lipca.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-semibold">12</p>
              </CardContent>
              <CardFooter>
                <Button variant="outline" size="sm">
                  Zobacz listę
                </Button>
              </CardFooter>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Przychód</CardTitle>
                <CardDescription>Kwoty prezentowane w PLN.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-semibold">12 480,00 zł</p>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableCaption>Przykładowe rezerwacje</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Numer</TableHead>
                    <TableHead>Klient</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Wartość</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="tabular-nums">REZ/0714/01</TableCell>
                    <TableCell>Anna Kowalska</TableCell>
                    <TableCell>
                      <Badge variant="secondary">Potwierdzona</Badge>
                    </TableCell>
                    <TableCell className="text-right">1 249,00 zł</TableCell>
                  </TableRow>
                  <TableRow data-state="selected">
                    <TableCell className="tabular-nums">REZ/0714/02</TableCell>
                    <TableCell>Jan Nowak</TableCell>
                    <TableCell>
                      <StatusBadge tone="attention">Oczekuje</StatusBadge>
                    </TableCell>
                    <TableCell className="text-right">849,00 zł</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </GallerySection>

        <GallerySection
          id="overlays"
          title="Select, menu i nakładki"
          description="Interakcje klawiaturowe i portale. Nakładki rozdziela obrys border - bez cieni."
        >
          <div className="flex flex-wrap items-center gap-3">
            <Select defaultValue="active">
              <SelectTrigger aria-label="Status rezerwacji" className="w-52">
                <SelectValue placeholder="Wybierz status" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Status</SelectLabel>
                  <SelectItem value="active">Aktywna</SelectItem>
                  <SelectItem value="waiting">Oczekuje</SelectItem>
                  <SelectSeparator />
                  <SelectItem value="closed">Zamknięta</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>

            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline">Otwórz szufladę</Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72">
                <SheetHeader>
                  <SheetTitle>Nawigacja</SheetTitle>
                  <SheetDescription>
                    Nakładka wysuwana z krawędzi - shell panelu chowa w niej
                    sidebar na wąskim ekranie. Rozdziela obrys, nie cień.
                  </SheetDescription>
                </SheetHeader>
              </SheetContent>
            </Sheet>

            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">Otwórz dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Potwierdź zmianę</DialogTitle>
                  <DialogDescription>
                    Przykład dialogu z tytułem, opisem i akcjami.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter showCloseButton>
                  <Button>Zapisz</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">Menu akcji</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Widok</DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={notifications}
                  onCheckedChange={setNotifications}
                >
                  Powiadomienia
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup
                  value={density}
                  onValueChange={setDensity}
                >
                  <DropdownMenuRadioItem value="wygodna">
                    Wygodna gęstość
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="zwarta">
                    Zwarta gęstość
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive">
                  Usuń wpis
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">Pokaż popover</Button>
              </PopoverTrigger>
              <PopoverContent>
                <PopoverHeader>
                  <PopoverTitle>Dostępność</PopoverTitle>
                  <PopoverDescription>
                    Nakładka pomocnicza zachowuje fokus i kontrast.
                  </PopoverDescription>
                </PopoverHeader>
              </PopoverContent>
            </Popover>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost">Najedź lub ustaw fokus</Button>
                </TooltipTrigger>
                <TooltipContent>Krótka informacja pomocnicza</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </GallerySection>

        <GallerySection
          id="calendar"
          title="Calendar"
          description="Język z interfejsu, dostępna nawigacja i wybór pojedynczej daty."
        >
          <Card className="w-fit max-w-full">
            <CardContent className="p-0">
              <Calendar
                mode="single"
                locale={dayPickerLocale(locale)}
                defaultMonth={new Date(2026, 6, 1)}
                selected={selectedDate}
                onSelect={setSelectedDate}
              />
            </CardContent>
          </Card>
        </GallerySection>
      </div>
    </main>
  );
}
