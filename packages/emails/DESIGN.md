# Projekt `@rental/emails`

Data: 2026-07-14  
Zakres: samodzielny pakiet transakcyjnych e-maili, bez integracji z aplikacjami

## Cel

`@rental/emails` dostarcza cztery polskie szablony transakcyjne jako komponenty
React oraz funkcje renderujące każdy szablon jednocześnie do HTML i tekstu
zwykłego. Pakiet nie wysyła wiadomości, nie korzysta z bazy i nie zna logiki
domenowej aplikacji. Wiring do panelu zostaje wykonany osobno.

## Publiczny interfejs

Pakiet eksportuje:

- `EmailConfirmation` i `EmailConfirmationProps`;
- `PasswordReset` i `PasswordResetProps`;
- `OrganizationInvitation`, `OrganizationInvitationProps` oraz lokalny typ
  `InvitationRole = "owner" | "staff"`;
- `NewOrderNotification` i `NewOrderNotificationProps`;
- `RenderedEmail = { html: string; text: string }`;
- `renderEmailConfirmation(props): Promise<RenderedEmail>`;
- `renderPasswordReset(props): Promise<RenderedEmail>`;
- `renderOrganizationInvitation(props): Promise<RenderedEmail>`;
- `renderNewOrderNotification(props): Promise<RenderedEmail>`.

Kwota i daty nowego zamówienia są przekazywane jako gotowe teksty. Ten
kontrakt jest świadomym placeholderem fazy 1: pakiet prezentacyjny nie
formatuje jeszcze wartości domenowych ani nie zależy od `@rental/core`.

## Architektura plików

```text
packages/emails/
├── DESIGN.md
├── README.md
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── preview/
│   ├── email-confirmation.tsx
│   ├── password-reset.tsx
│   ├── organization-invitation.tsx
│   └── new-order-notification.tsx
├── src/
│   ├── components/email-layout.tsx
│   ├── templates/
│   ├── index.ts
│   ├── render.ts
│   └── styles.ts
└── test/
    └── emails.test.tsx
```

Komponent `EmailLayout` odpowiada wyłącznie za wspólną strukturę, nagłówek,
stopkę, szerokość treści i prezentację CTA. Poszczególne szablony odpowiadają
za treść i dane właściwe dla danego zdarzenia. `render.ts` jest jedynym
miejscem, które zamienia element React na gotowe warianty HTML i plain text.

## Branding i kompatybilność

Źródłem znaczenia kolorów jest jasny motyw `@rental/ui` opisany w ADR-007,
ale pakiet nie importuje `@rental/ui`. W `src/styles.ts` żyją jawne odpowiedniki
hex używane w stylach inline:

- tło i karta: `#ffffff`;
- tekst podstawowy: `#0a0a0a`;
- akcja główna: `#171717`;
- tekst na akcji: `#fafafa`;
- powierzchnia wyciszona: `#f7f7f7`;
- tekst wyciszony: `#555555`;
- obramowanie: `#e8e8e8`.

Nie używamy `oklch`, Tailwinda, zewnętrznych fontów ani komponentów React z
`@rental/ui`. Stos fontów to bezpieczne systemowe fallbacki:
`-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif`.

Nagłówek i stopka używają tymczasowej nazwy produktu `<NAZWA>`. Szablony mają
tylko jasny motyw, ponieważ wymuszanie motywu ciemnego w klientach pocztowych
nie jest wystarczająco spójne. CTA ma również widoczny link tekstowy, dzięki
czemu wiadomość pozostaje użyteczna, gdy klient nie wyświetli przycisku.

## Szablony

1. Potwierdzenie adresu e-mail — prosty opis i link aktywacyjny.
2. Reset hasła — link resetujący oraz informacja, by zignorować wiadomość,
   jeśli odbiorca nie inicjował operacji.
3. Zaproszenie do organizacji — nazwa organizacji, rola przetłumaczona na
   polski i link akceptacji.
4. Nowe zamówienie — numer, klient, kwota, daty oraz link do zamówienia;
   pola są placeholderem kontraktu fazy 1.

Każdy szablon zawiera krótkie preview text, jedno główne CTA i prosty język
polski bez tonu korporacyjnego.

## Podgląd

React Email Preview jest uruchamiany niezależnie od panelu poleceniem:

```bash
pnpm --filter @rental/emails preview
```

Pliki w `preview/` są cienkimi wrapperami z przykładowymi `PreviewProps`.
Używają publicznych komponentów pakietu, więc podgląd i produkcyjne renderowanie
nie rozchodzą się na dwa osobne zestawy szablonów.

## Zależności

Greenfield korzysta z najnowszej stabilnej wersji React Email 6, która
udostępnia komponenty i funkcję `render` z jednego pakietu `react-email`.
React i React DOM pozostają peer dependencies pakietu, a narzędzia typów,
Vitest i implementacje peer dependencies są zależnościami deweloperskimi.
Jeśli weryfikacja ujawni konkretny bloker wersji 6, dopuszczalny jest powrót do
linii 5; powód musi wtedy zostać dopisany w tym dokumencie.

## Testy i kryteria akceptacji

Vitest uruchamia render każdego szablonu i sprawdza:

- brak błędu podczas renderowania;
- obecność CTA, docelowego URL i danych z propsów w HTML;
- niepustą wersję tekstową zawierającą kluczowe dane i URL;
- brak `oklch` w wygenerowanym HTML;
- wspólny branding `<NAZWA>`.

Końcowa weryfikacja obejmuje `pnpm typecheck`, `pnpm lint`, `pnpm test` oraz
oba joby CI. Dokumentacja modułu i wpis w dzienniku budowy trafiają do
`docs/dokumentacja/index.html`; `README.md` opisuje lokalne użycie i podgląd.

## Poza zakresem

- wysyłka przez dostawcę e-mail;
- integracja z auth, panelem lub storefrontem;
- baza danych, kolejki, retry i logowanie wysyłek;
- branding per tenant, logo i wybrana nazwa produktu;
- formatowanie kwot i dat przez logikę domenową;
- edycja `packages/ui`, aplikacji i workflow CI.
