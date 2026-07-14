# @rental/ui — projekt design systemu

## Cel i zakres

`@rental/ui` jest jednym źródłem prawdy o warstwie wizualnej platformy.
Pakiet portuje dojrzały system z repozytorium referencyjnego, bez tworzenia
nowego języka wizualnego. Zakres pierwszego portu obejmuje tokeny Tailwind CSS
4, tryb jasny i ciemny, narzędzie `cn` oraz 15 rodzin prymitywów interfejsu.

Poza zakresem pozostają komponenty domenowe, treściowe, blogowe i produktowe.

## Architektura

- `src/styles.css` zawiera tokeny, animacje i bazowe style. Aplikacje importują
  je przez `@rental/ui/styles.css` i nie utrzymują własnych kopii tokenów.
- `src/components/*.tsx` zawiera prymitywy. Wszystkie publiczne komponenty,
  warianty i typy są eksportowane z głównego wejścia `@rental/ui`.
- `src/lib/cn.ts` scala klasy warunkowe i rozwiązuje konflikty klas Tailwind.
- `apps/panel/app/design-system/page.tsx` jest galerią konsumencką. Korzysta
  wyłącznie z publicznego interfejsu pakietu i prezentuje oba motywy.

## Tokeny i rozstrzygnięcie driftu

Kanoniczny jasny motyw wykorzystuje najnowszą achromatyczną paletę redesignu
backoffice. Zastępuje ona starszą, lekko niebieskawą paletę oraz osobny selektor
`office-light`. Kanoniczny ciemny motyw zachowuje aktualne wartości `.dark`.

- kolory semantyczne są zapisane w OKLCH;
- bazowy radius wynosi `0.625rem`, ze skalą `sm`, `md`, `lg`, `xl`;
- kontrolki i zwykłe powierzchnie są płaskie, a cienie pozostają dla nakładek,
  menu i dialogów;
- font sans to Inter w wagach 400, 500, 600 i 700;
- font monospace to Geist Mono z bezpiecznym fallbackiem systemowym;
- spacing zachowuje standardową skalę Tailwind CSS 4;
- motyw jest sterowany klasą `.dark`, respektuje `color-scheme` i preferencję
  ograniczenia ruchu.

## Publiczny interfejs

Pakiet eksportuje:

- `Button`, `buttonVariants` — warianty `default`, `destructive`, `outline`,
  `secondary`, `ghost`, `link`; rozmiary `default`, `sm`, `lg`, `icon`;
- `Input`;
- `Card`, `CardHeader`, `CardFooter`, `CardTitle`, `CardDescription`,
  `CardContent`;
- `Dialog`, `DialogClose`, `DialogContent`, `DialogDescription`,
  `DialogFooter`, `DialogHeader`, `DialogOverlay`, `DialogPortal`,
  `DialogTitle`, `DialogTrigger`;
- `Table`, `TableHeader`, `TableBody`, `TableFooter`, `TableHead`, `TableRow`,
  `TableCell`, `TableCaption`;
- `Select`, `SelectContent`, `SelectGroup`, `SelectItem`, `SelectLabel`,
  `SelectScrollDownButton`, `SelectScrollUpButton`, `SelectSeparator`,
  `SelectTrigger`, `SelectValue`;
- `Badge`, `badgeVariants`, `BadgeProps` — warianty `default`, `secondary`,
  `destructive`, `outline`;
- `Checkbox`, `Label`, `Textarea`;
- pełną rodzinę `DropdownMenu*`, łącznie z checkboxami, radiem i podmenu;
- `Popover`, `PopoverTrigger`, `PopoverContent`, `PopoverAnchor`,
  `PopoverHeader`, `PopoverTitle`, `PopoverDescription`;
- `Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider`;
- `Separator`;
- `Calendar`, `CalendarDayButton`.

Teksty dostępności dostarczane przez pakiet są po polsku. Pozostała treść jest
przekazywana przez konsumenta.

## Galeria

Trasa `/design-system` w panelu prezentuje tokeny oraz każdy prymityw w stanach
podstawowych, alternatywnych, nieaktywnych i błędnych. Przełącznik motywu działa
bez zależności od backendu. Układ jest responsywny od małego ekranu do desktopu,
a interaktywne nakładki można obsłużyć klawiaturą.

## Jakość i testy

- test kontraktu pilnuje kompletności eksportów publicznych;
- test tokenów pilnuje pojedynczych definicji, obecności obu motywów i decyzji
  dotyczących radiusów, cieni oraz fontów;
- testy komponentów sprawdzają warianty i krytyczne atrybuty dostępności;
- galeria jest weryfikowana przez produkcyjny build panelu oraz kontrolę obu
  motywów w przeglądarce;
- semantyczne pary tekstu i tła używane przez prymitywy spełniają WCAG AA;
- zamknięcie zadania wymaga `pnpm typecheck`, `pnpm lint` i `pnpm test`.
