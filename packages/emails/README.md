# `@avably/emails`

Pakiet polskich e-maili transakcyjnych dla platformy wynajmu. Zawiera
komponenty React Email oraz wspólne funkcje renderujące HTML i wersję tekstową.
Nie wysyła wiadomości i nie zależy od aplikacji, bazy ani `@avably/ui`.

## Publiczne API

- `EmailConfirmation` oraz `renderEmailConfirmation(props)`;
- `PasswordReset` oraz `renderPasswordReset(props)`;
- `OrganizationInvitation` oraz `renderOrganizationInvitation(props)`;
- `NewOrderNotification` oraz `renderNewOrderNotification(props)`;
- typy propsów, `InvitationRole` i `RenderedEmail`.

Każda funkcja renderująca zwraca `Promise<{ html: string; text: string }>`. Na
przykład:

```ts
import { renderEmailConfirmation } from "@avably/emails";

const email = await renderEmailConfirmation({
  confirmationUrl: "https://app.avably.io/auth/confirm?token=...",
  recipientName: "Anna",
});

await emailProvider.send({
  html: email.html,
  text: email.text,
});
```

Wiring do dostawcy e-mail i aplikacji pozostaje poza tym pakietem.

## Podgląd bez panelu

W katalogu głównym repozytorium uruchom:

```bash
pnpm --filter @avably/emails preview
```

Galeria React Email będzie dostępna pod `http://localhost:3002`. Pokazuje
cztery szablony z bezpiecznymi przykładowymi danymi i automatycznie odświeża
widok po zmianie plików.

## Testy i kontrola jakości

```bash
pnpm --filter @avably/emails typecheck
pnpm --filter @avably/emails lint
pnpm --filter @avably/emails test
```

Testy renderują wszystkie szablony do HTML i plain text, sprawdzają CTA, linki,
dane wejściowe, branding i zakaz używania `oklch`.

## Kontrakt zamówienia w fazie 1

`NewOrderNotificationProps` przyjmuje numer, klienta, kwotę oraz daty jako
gotowe teksty. To świadomy placeholder fazy 1: pakiet prezentacyjny nie
formatuje wartości domenowych. Kontrakt może zostać doprecyzowany podczas
integracji z `@avably/core`.
