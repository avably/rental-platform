import { expect, test, type Page } from "@playwright/test";

import { loginToPanel } from "../lib/checkout";
import { adminClient } from "../lib/db";
import { PANEL_URL } from "../lib/env";
import { readSeedState } from "../lib/seed-state";

/**
 * Ogniwo 6: LISTA PRZESYŁEK MIEŚCI SIĘ W SWOJEJ KOLUMNIE (ADR-188).
 *
 * ================== DLACZEGO POMIAR, A NIE ZRZUT ==================
 *
 * Defekt, który tu pilnujemy, jest niewidoczny w statycznym HTML-u i nie
 * daje się złapać obecnością klasy: tabela przesyłek miała szerokość WŁASNĄ
 * 1119 px przy 624 px dostępnych w kolumnie treści szczegółu zamówienia.
 * Kontener panelu ma sufit (`max-w-5xl` minus padding, ADR-243), a 320 px
 * zabiera kolumna boczna — więc kolumna główna NIE ROŚNIE wraz z oknem i przy
 * ŻADNEJ szerokości ekranu tabela się nie mieściła.
 *
 * Bramka mierzy więc SKUTEK po renderze w prawdziwej przeglądarce:
 * szerokość własną bloku przesyłek wobec szerokości dostępnej w kolumnie,
 * przy czterech szerokościach okna. Warunek: własna ≤ dostępna.
 *
 * ================== DLACZEGO `scrollWidth`, A NIE SAM PROSTOKĄT ==========
 *
 * Element z `overflow-x: auto` PRZYCINA swoje dziecko: prostokąt kontenera
 * jest wtedy równy kolumnie, choć w środku siedzi treść dwa razy szersza.
 * Pomiar oparty wyłącznie na `getBoundingClientRect()` przodka byłby przez
 * to ZIELONY nad tabelą, która nadal nie mieści się w kolumnie — dlatego
 * sonda schodzi do KAŻDEGO potomka i bierze maksimum z obu miar. To także
 * powód, dla którego samo „schowanie nadmiaru w przewijaniu” nie zdaje tej
 * bramki: przewijanie nie zmniejsza szerokości własnej, tylko ją zasłania.
 *
 * ================== KONTROLA PRZYRZĄDU ==================
 *
 * Sonda raportuje, ILE elementów zmierzyła i czy widziała treść wierszy
 * (numer u dostawcy, numer śledzenia). Bez tego zielony wynik mógłby
 * oznaczać „zmierzyłem pusty zbiór” — dokładnie ta pułapka wywróciła
 * sondę widoczności w sąsiedniej sesji.
 */

/**
 * Pięć okien, nie jedno „reprezentatywne”. Szerokość kolumny głównej zmienia
 * się inaczej niż okno: pasek boczny zjada 236 px, kontener ma sufit, a przy
 * `lg` dochodzi kolumna boczna 320 px — więc kolumna rośnie tylko do pewnego
 * momentu, a poniżej `lg` skacze w górę (siatka zwija się do jednej kolumny).
 * Telefon jest w zestawie celowo: układ ma być płynny z konstrukcji, a nie
 * dostrojony do desktopu.
 */
const OKNA = [390, 1024, 1280, 1440, 1920] as const;

/**
 * Wartości w KSZTAŁCIE PRODUKCJI — to one rozpychają układ. Numery przesyłek
 * i śledzenia u przewoźników krajowych mają kilkanaście–dwadzieścia kilka
 * znaków, a surowy status dostawcy potrafi być zdaniem.
 *
 * NIEZMIENNIK IDEMPOTENCJI (ADR-223, unikat częściowy z 0091): co najwyżej
 * JEDNA aktywna (NIE-anulowana) przesyłka na (order, typ). Dlatego trzy wiersze
 * to realna historia: aktywny outbound + aktywny return + WCZEŚNIEJSZY outbound
 * ANULOWANY (pierwsza próba wycofana, nadano ponownie). Anulowana zachowuje
 * numer, więc nadal renderuje się w kolumnie — geometrii to nie zmienia, a seed
 * przestaje łamać unikat (dwa aktywne outbound jednego zamówienia).
 */
const PRZESYLKI = [
  {
    shipment_type: "outbound",
    status: "in_transit",
    provider_order_number: "GK-2026-08-0000148372",
    provider_status: "PRZESYLKA_W_DORECZENIU_ODDZIAL_WARSZAWA_OKECIE",
    tracking_number: "00259776543210987654321",
    tracking_url:
      "https://sledzenie.przewoznik.example/pl/przesylka?numer=00259776543210987654321&nadawca=wypozyczalnia",
    price_grosze: 2390,
  },
  {
    shipment_type: "return",
    status: "created",
    provider_order_number: "GK-2026-08-0000148519",
    provider_status: null,
    tracking_number: "00259776543211122334455",
    tracking_url:
      "https://sledzenie.przewoznik.example/pl/przesylka?numer=00259776543211122334455&nadawca=wypozyczalnia",
    price_grosze: 1990,
  },
  {
    shipment_type: "outbound",
    status: "cancelled",
    provider_order_number: "GK-2026-07-0000139004",
    provider_status: "ANULOWANA_PRZEZ_NADAWCE_PRZED_PRZEKAZANIEM_KURIEROWI",
    tracking_number: "00259776543209988776655",
    tracking_url:
      "https://sledzenie.przewoznik.example/pl/przesylka?numer=00259776543209988776655&nadawca=wypozyczalnia",
    price_grosze: 2390,
  },
] as const;

/** Zamówienie kurierskie z trzema przesyłkami — zasiane wprost, bo ścieżka
 * nadania idzie do API przewoźnika, którego suita nie woła. Asercje dotyczą
 * WYŁĄCZNIE geometrii widoku, więc pochodzenie wierszy nic tu nie zmienia. */
async function zasiejZamowienieZPrzesylkami(tenantId: string): Promise<string> {
  const admin = adminClient();
  const znacznik = Date.now();

  const { data: klient, error: bladKlienta } = await admin
    .from("customers")
    .insert({
      tenant_id: tenantId,
      email: `e2e-przesylki-${znacznik}@example.com`,
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
      total_deposit_grosze: 100_000,
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

  const { error: bladPrzesylek } = await admin.from("courier_shipments").insert(
    PRZESYLKI.map((przesylka) => ({
      ...przesylka,
      tenant_id: tenantId,
      order_id: orderId,
      length_cm: 40,
      width_cm: 30,
      height_cm: 20,
      weight_kg: 12.5,
      content: "Sprzęt z wypożyczalni",
    })),
  );
  if (bladPrzesylek) throw new Error(`Nie zasiałem przesyłek: ${bladPrzesylek.message}`);

  return orderId;
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
 * Sonda geometrii bloku przesyłek. Wykonuje się W STRONIE, więc czyta
 * prawdziwy layout silnika, a nie nasze wyobrażenie o nim.
 */
async function zmierz(page: Page, okno: number): Promise<Pomiar> {
  await page.setViewportSize({ width: okno, height: 900 });
  // Zmiana okna przelicza layout dopiero w kolejnej klatce — bez tego pomiar
  // bywa z poprzedniej szerokości.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );

  return page.evaluate(
    ({ numerUDostawcy, numerSledzenia }) => {
      const blok = document.querySelector("[data-shipments]");
      if (!blok) throw new Error("Nie znalazłem bloku przesyłek ([data-shipments]) na stronie.");

      // Kolumna, w której blok ma się zmieścić: sekcja dostawy stoi wprost
      // w kolumnie głównej siatki szczegółu, więc jej pole treści JEST
      // szerokością dostępną.
      const sekcja = blok.closest("section");
      if (!sekcja) throw new Error("Blok przesyłek stoi poza sekcją dostawy.");

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

      const tresc = blok.textContent ?? "";
      return {
        okno: window.innerWidth,
        dostepna: sekcja.clientWidth,
        wlasna,
        zmierzonychElementow: elementy.length,
        najszerszy,
        widziTresc: tresc.includes(numerUDostawcy) && tresc.includes(numerSledzenia),
      };
    },
    {
      numerUDostawcy: PRZESYLKI[0].provider_order_number,
      numerSledzenia: PRZESYLKI[0].tracking_number,
    },
  );
}

test("blok przesyłek nie przekracza szerokości swojej kolumny (ADR-188)", async ({ page }) => {
  const seed = readSeedState();
  const orderId = await zasiejZamowienieZPrzesylkami(seed.tenantId);

  await loginToPanel(page, PANEL_URL, seed);
  await page.goto(`${PANEL_URL}/pl/zamowienia/${orderId}`);
  // Jawny, hojny budżet: szczegół zamówienia robi kilka odczytów na żądanie,
  // a runner bywa dzielony z innymi przebiegami. Domyślne 10 s mierzyłoby
  // dostępność procesora, nie zachowanie ekranu.
  await expect(page.locator("[data-shipments]")).toBeVisible({ timeout: 30_000 });

  const pomiary: Pomiar[] = [];
  for (const okno of OKNA) {
    pomiary.push(await zmierz(page, okno));
  }

  // Raport wchodzi do logu ZAWSZE — jest dowodem pomiarowym zadania, a nie
  // tylko diagnostyką porażki.
  console.log(
    `[ADR-188] pomiar bloku przesyłek\n${pomiary
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
    // bloku bez wierszy niczego nie dowodzi.
    expect(
      pomiar.widziTresc,
      `okno ${pomiar.okno} px: sonda nie widzi treści wierszy — mierzy nie to, co trzeba`,
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
      `okno ${pomiar.okno} px: blok przesyłek ma ${pomiar.wlasna} px przy ${pomiar.dostepna} px ` +
        `dostępnych w kolumnie (najszerszy element: ${pomiar.najszerszy})`,
    ).toBeLessThanOrEqual(pomiar.dostepna);
  }
});
