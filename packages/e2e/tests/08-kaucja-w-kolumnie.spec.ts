import { expect, test, type Page } from "@playwright/test";

import { loginToPanel } from "../lib/checkout";
import { adminClient } from "../lib/db";
import { PANEL_URL } from "../lib/env";
import { readSeedState } from "../lib/seed-state";

/**
 * Ogniwo 8: REJESTR KAUCJI MIEŚCI SIĘ W SWOJEJ KOLUMNIE (ADR-204).
 *
 * ================== TA SAMA KLASA DEFEKTU CO PRZESYŁKI (ADR-188) ==========
 *
 * Rejestr kaucji na szczególe zamówienia stał w tabeli owiniętej przez
 * prymityw `Table` w `overflow-x-auto` — więc „nie mieści się" zamieniało
 * się w NIEWIDOCZNE przewijanie i nic tego nie mierzyło. Rozpychaczem jest
 * tu NIEOGRANICZONY tekst operatora (powód potrącenia — kolumna `reason`
 * bez limitu długości) oraz odnośnik dowodowy u dostawcy płatności
 * (`provider_reference`). Kolumna treści szczegółu zamówienia ma sufit
 * ~752 px niezależnie od okna (`max-w-6xl` minus 320 px kolumny bocznej),
 * więc to nie jest defekt wąskiego ekranu — patrz ADR-188.
 *
 * Bramka mierzy SKUTEK po renderze w prawdziwej przeglądarce: szerokość
 * własną rejestru wobec szerokości dostępnej w kolumnie, przy pięciu
 * szerokościach okna. Warunek: własna ≤ dostępna. jsdom nie liczy layoutu,
 * dlatego ten pomiar NIE MOŻE mieszkać w jobie `ci` — job `e2e` ma chromium.
 *
 * ================== DLACZEGO `scrollWidth` + PROSTOKĄT KAŻDEGO POTOMKA =====
 *
 * Element z `overflow-x: auto` PRZYCINA swoje dziecko: prostokąt kontenera
 * równa się kolumnie, choć w środku siedzi treść dwa razy szersza. Pomiar
 * samego przodka byłby ZIELONY nad tabelą, która się nie mieści — sonda
 * schodzi więc do KAŻDEGO potomka i bierze maksimum z obu miar (mechanika
 * z `06-przesylki-w-kolumnie.spec.ts`).
 *
 * ================== KONTROLA PRZYRZĄDU ==================
 *
 * Sonda raportuje, ILE elementów zmierzyła i czy widzi treść wierszy kaucji
 * (długi token z powodu potrącenia + odnośnik u dostawcy). Zielony wynik na
 * pustym zbiorze albo na zwiniętym `<details>` (display:none → zerowe
 * prostokąty) niczego by nie dowodził.
 */

/** Pięć okien jak w ADR-188 — kolumna główna zmienia się inaczej niż okno,
 * a telefon jest w zestawie celowo: układ ma być płynny z konstrukcji. */
const OKNA = [390, 1024, 1280, 1440, 1920] as const;

/**
 * Najdłuższy NIEROZDZIELNY token powodu — identyfikator wklejony przez
 * operatora (zgłoszenie serwisowe). To on jest twardym przypadkiem
 * zawijania: tekst ze spacjami zawinie się sam, pojedynczy token bez
 * `overflow-wrap: break-word` rozpycha kartę poza kolumnę.
 */
const TOKEN_POWODU = "ZGLOSZENIESERWISOWE20260812WIERTNICADHZ400OBUDOWAPRZEKLADNIWYCENA48000GR";

/**
 * Powód potrącenia W KSZTAŁCIE PRODUKCJI: kolumna `reason` nie ma limitu
 * długości, a operator wkleja tu protokoły i identyfikatory. ~500 znaków —
 * test na granicy z rozstrzygnięcia PM.
 */
const DLUGI_POWOD =
  "Uszkodzenie wiertnicy stwierdzone przy zwrocie: pęknięta obudowa przekładni " +
  "i wyłamany uchwyt boczny. Klient potwierdził uszkodzenie na miejscu przy " +
  "odbiorze, protokół spisany w obecności pracownika magazynu i podpisany przez " +
  "obie strony. Wycena serwisu obejmuje wymianę obudowy przekładni, robociznę " +
  `oraz kalibrację narzędzia po naprawie. Identyfikator zgłoszenia: ${TOKEN_POWODU} ` +
  "(numer nadany automatycznie przez system serwisowy dostawcy). Pozostała część " +
  "kaucji wraca do klienta po zakończeniu rozliczenia zamówienia.";

/** Zamówienie z czterema zdarzeniami kaucji zasianymi wprost — asercje
 * dotyczą WYŁĄCZNIE geometrii widoku, więc pochodzenie wierszy nic tu nie
 * zmienia. Pobrania idą w tablicy PRZED rozliczeniami: bramka
 * `deposit_events_gate` (0011) re-checkuje saldo także w obrębie jednego
 * polecenia INSERT. */
async function zasiejZamowienieZKaucja(
  tenantId: string,
): Promise<{ orderId: string; providerReference: string }> {
  const admin = adminClient();
  const znacznik = Date.now();
  // Odnośnik u dostawcy: unikalny per przebieg (indeks częściowy 0031 na
  // (provider, provider_reference)), długość w kształcie produkcji.
  const providerReference = `pi_3Rq${znacznik}KaucjaNajmuRazemZPlatnoscia0029`;

  const { data: klient, error: bladKlienta } = await admin
    .from("customers")
    .insert({
      tenant_id: tenantId,
      email: `e2e-kaucja-${znacznik}@example.com`,
      full_name: "Przedsiębiorstwo Budowlano-Montażowe Nowakowski i Wspólnicy",
      phone: "+48 600 700 800",
      address_street: "Aleja Niepodległości 145A/23",
      address_zip: "02-555",
      address_city: "Warszawa",
    })
    .select("id")
    .single();
  if (bladKlienta || !klient) throw new Error(`Nie zasiałem klienta: ${bladKlienta?.message}`);

  const { data: zamowienie, error: bladZamowienia } = await admin
    .from("orders")
    .insert({
      tenant_id: tenantId,
      customer_id: (klient as { id: string }).id,
      start_date: "2026-08-10",
      end_date: "2026-08-17",
      delivery_method: "courier",
      delivery_grosze: 2390,
      total_rental_grosze: 45_000,
      total_deposit_grosze: 150_000,
      delivery_address_source: "custom",
      delivery_address_name: "Przedsiębiorstwo Budowlano-Montażowe Nowakowski i Wspólnicy",
      delivery_address_street: "Aleja Niepodległości 145A/23",
      delivery_address_zip: "02-555",
      delivery_address_city: "Warszawa",
    })
    .select("id")
    .single();
  if (bladZamowienia || !zamowienie) {
    throw new Error(`Nie zasiałem zamówienia: ${bladZamowienia?.message}`);
  }
  const orderId = (zamowienie as { id: string }).id;

  // Jawne `created_at` z odstępem: cztery wiersze wstawione jednym
  // poleceniem dostałyby ten sam `now()` (czas startu transakcji) i porządek
  // chronologii — a z nim mapowanie sald na wiersze — byłby losowy.
  // `provider` jawnie w KAŻDYM wierszu: przy bulk insert PostgREST uzupełnia
  // brakujące klucze wiersza wartością NULL, nie defaultem kolumny.
  const { error: bladZdarzen } = await admin.from("deposit_events").insert([
    {
      tenant_id: tenantId,
      order_id: orderId,
      kind: "collected",
      amount_grosze: 100_000,
      provider: "manual",
      created_at: "2026-08-10T09:00:00.000Z",
    },
    {
      tenant_id: tenantId,
      order_id: orderId,
      kind: "collected",
      amount_grosze: 50_000,
      provider: "stripe",
      provider_reference: providerReference,
      created_at: "2026-08-10T09:05:00.000Z",
    },
    {
      tenant_id: tenantId,
      order_id: orderId,
      kind: "deducted",
      amount_grosze: 40_000,
      reason_code: "damage",
      reason: DLUGI_POWOD,
      provider: "manual",
      created_at: "2026-08-17T15:30:00.000Z",
    },
    {
      tenant_id: tenantId,
      order_id: orderId,
      kind: "refunded",
      amount_grosze: 60_000,
      provider: "manual",
      created_at: "2026-08-17T15:45:00.000Z",
    },
  ]);
  if (bladZdarzen) throw new Error(`Nie zasiałem zdarzeń kaucji: ${bladZdarzen.message}`);

  return { orderId, providerReference };
}

type Pomiar = {
  okno: number;
  dostepna: number;
  wlasna: number;
  zmierzonychElementow: number;
  najszerszy: string;
  widziTresc: boolean;
};

/**
 * Sonda geometrii rejestru kaucji. Wykonuje się W STRONIE, więc czyta
 * prawdziwy layout silnika, a nie nasze wyobrażenie o nim.
 *
 * Kotwicą jest `#kaucja > details` (rozwijane „Szczegóły rozliczenia"),
 * a nie znacznik implementacji: bramka ma mierzyć CAŁĄ zawartość rejestru
 * niezależnie od tego, czym jest zbudowany — powrót tabeli w to miejsce ma
 * być czerwony, nawet gdyby zdjął znaczniki kart.
 */
async function zmierz(
  page: Page,
  okno: number,
  tresc: { tokenPowodu: string; odnosnikDostawcy: string },
): Promise<Pomiar> {
  await page.setViewportSize({ width: okno, height: 900 });
  // Zmiana okna przelicza layout dopiero w kolejnej klatce — bez tego pomiar
  // bywa z poprzedniej szerokości.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );

  return page.evaluate(({ tokenPowodu, odnosnikDostawcy }) => {
    const blok = document.querySelector("#kaucja > details");
    if (!blok) throw new Error("Nie znalazłem rejestru kaucji (#kaucja > details) na stronie.");
    if (!(blok as HTMLDetailsElement).open) {
      throw new Error("Rejestr kaucji jest ZWINIĘTY — pomiar na display:none niczego nie dowodzi.");
    }

    // Kolumna, w której rejestr ma się zmieścić: sekcja kaucji stoi wprost
    // w kolumnie głównej siatki szczegółu, więc jej pole treści JEST
    // szerokością dostępną.
    const sekcja = blok.closest("section");
    if (!sekcja) throw new Error("Rejestr kaucji stoi poza sekcją kaucji.");

    const elementy = [blok, ...blok.querySelectorAll("*")] as HTMLElement[];
    let wlasna = 0;
    let najszerszy = "";
    for (const element of elementy) {
      // Dwie miary, bo każda widzi co innego: prostokąt łapie element
      // wystający poza kolumnę, `scrollWidth` łapie treść PRZYCIĘTĄ przez
      // przodka z przewijaniem (tabela w `overflow-x-auto`).
      const szerokosc = Math.max(
        element.scrollWidth,
        Math.ceil(element.getBoundingClientRect().width),
      );
      if (szerokosc > wlasna) {
        wlasna = szerokosc;
        najszerszy = `${element.tagName.toLowerCase()}${
          element.dataset.slot ? `[data-slot=${element.dataset.slot}]` : ""
        }`;
      }
    }

    const tekst = blok.textContent ?? "";
    return {
      okno: window.innerWidth,
      dostepna: sekcja.clientWidth,
      wlasna,
      zmierzonychElementow: elementy.length,
      najszerszy,
      widziTresc: tekst.includes(tokenPowodu) && tekst.includes(odnosnikDostawcy),
    };
  }, tresc);
}

test("rejestr kaucji nie przekracza szerokości swojej kolumny (ADR-204)", async ({ page }) => {
  const seed = readSeedState();
  const { orderId, providerReference } = await zasiejZamowienieZKaucja(seed.tenantId);

  await loginToPanel(page, PANEL_URL, seed);
  await page.goto(`${PANEL_URL}/pl/zamowienia/${orderId}`);
  // Jawny, hojny budżet: szczegół zamówienia robi kilka odczytów na żądanie,
  // a runner bywa dzielony z innymi przebiegami.
  await expect(page.locator("#kaucja > details > summary")).toBeVisible({ timeout: 30_000 });

  // Chronologia rejestru mieszka w rozwijanych „Szczegółach rozliczenia"
  // (decyzja D7/N5 — dowód w sporze, nie pierwszy ekran). Zwinięty
  // `<details>` ma display:none na treści, więc pomiar wymaga otwarcia —
  // tak samo, jak zrobi to operator.
  await page.locator("#kaucja > details > summary").click();
  await expect(page.locator("#kaucja > details")).toHaveAttribute("open", "");

  const tresc = { tokenPowodu: TOKEN_POWODU, odnosnikDostawcy: providerReference };
  const pomiary: Pomiar[] = [];
  for (const okno of OKNA) {
    pomiary.push(await zmierz(page, okno, tresc));
  }

  // Raport wchodzi do logu ZAWSZE — jest dowodem pomiarowym zadania, a nie
  // tylko diagnostyką porażki.
  console.log(
    `[ADR-204] pomiar rejestru kaucji\n${pomiary
      .map(
        (p) =>
          `  okno ${p.okno} px → własna ${p.wlasna} px / dostępna ${p.dostepna} px ` +
          `(${p.wlasna <= p.dostepna ? "MIEŚCI SIĘ" : `PRZEPEŁNIA o ${p.wlasna - p.dostepna} px`}` +
          `, najszerszy: ${p.najszerszy}, zmierzonych elementów: ${p.zmierzonychElementow})`,
      )
      .join("\n")}`,
  );

  for (const pomiar of pomiary) {
    // KONTROLA PRZYRZĄDU najpierw: zielony wynik na pustym zbiorze albo na
    // rejestrze bez wierszy niczego nie dowodzi.
    expect(
      pomiar.widziTresc,
      `okno ${pomiar.okno} px: sonda nie widzi treści wierszy kaucji — mierzy nie to, co trzeba`,
    ).toBe(true);
    expect(
      pomiar.zmierzonychElementow,
      `okno ${pomiar.okno} px: sonda zmierzyła podejrzanie mało elementów`,
    ).toBeGreaterThan(30);
    expect(pomiar.dostepna, `okno ${pomiar.okno} px: kolumna ma zerową szerokość`).toBeGreaterThan(
      200,
    );

    expect(
      pomiar.wlasna,
      `okno ${pomiar.okno} px: rejestr kaucji ma ${pomiar.wlasna} px przy ${pomiar.dostepna} px ` +
        `dostępnych w kolumnie (najszerszy element: ${pomiar.najszerszy})`,
    ).toBeLessThanOrEqual(pomiar.dostepna);
  }
});
