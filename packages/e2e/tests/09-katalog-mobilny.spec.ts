import { expect, test, type Page } from "@playwright/test";

import { loginToPanel } from "../lib/checkout";
import { adminClient } from "../lib/db";
import { PANEL_URL } from "../lib/env";
import { readSeedState } from "../lib/seed-state";

/**
 * Ogniwo 9: KATALOG MA WARIANT MOBILNY I MIEŚCI SIĘ NA TELEFONIE (ADR-205).
 *
 * ================== OSTATNIA GŁÓWNA LISTA BEZ KART ==================
 *
 * Pomiar ADR-204 pokazał, że katalog był JEDYNĄ główną listą panelu bez
 * wariantu mobilnego: tabela `min-w-[860px]` w `overflow-x-auto` dawała na
 * telefonie (390 px) niewidoczne przewijanie poziome — operator scrollował
 * w bok przy każdym produkcie, a kaucja, egzemplarze, teren i status żyły
 * poza ekranem. Od ADR-205 do progu `md` tabela ustępuje STOSOWI KART
 * (wzorzec list zamówień i klientów), a ta bramka mierzy SKUTEK po renderze
 * w prawdziwej przeglądarce. jsdom nie liczy layoutu, więc pomiar NIE MOŻE
 * mieszkać w jobie `ci` — job `e2e` ma chromium.
 *
 * ================== TRZY KŁAMSTWA DO ZŁAPANIA ==================
 *
 * 1. GEOMETRIA (okno 390 px): cała kolumna treści katalogu — karty, toolbar,
 *    wszystko — ma szerokość własną ≤ dostępnej. Sonda mechaniką ogniwa
 *    06/08: maksimum ze `scrollWidth` I prostokąta po WSZYSTKICH potomkach,
 *    bo kontener przewijania PRZYCINA dziecko i pomiar samego przodka byłby
 *    zielony nad tabelą, która się nie mieści. Kotwicą jest kontener panelu
 *    (`data-panel-container`), NIE znacznik kart: powrót JAKIEJKOLWIEK
 *    niemieszczącej się konstrukcji na telefon jest czerwony, nawet gdyby
 *    zdjął `data-product-card`.
 * 2. PODWÓJNY RENDER: na telefonie widoczne KARTY, nie tabela; na desktopie
 *    (1440 px) tabela, nie karty. Bez tego progu `md:` operator dostawałby
 *    obie kopie listy naraz.
 * 3. KONTROLA PRZYRZĄDU: sonda raportuje, ile elementów zmierzyła i czy
 *    widzi treść wierszy (nazwy produktów z bazy) — zieleń na pustym zbiorze
 *    albo na cudzym ekranie niczego nie dowodzi.
 *
 * Desktopowa tabela CELOWO bez asercji geometrii: od `md` w górę dzieli
 * rodzinę defektu z listami zamówień/klientów (ADR-204, osobna kolejka) —
 * ten PR dodaje wariant mobilny, nie przebudowuje tabel.
 */

/** Nazwa w kształcie produkcji — długa, ze znakami diakrytycznymi; twardy
 * przypadek zawijania w karcie o szerokości ~326 px pola treści. */
const DLUGA_NAZWA =
  "Zagęszczarka rewersyjna 500 kg z osprzętem do gruntów spoistych i kostki brukowej";

/** Drugi produkt: nieaktywny, bez egzemplarzy i bez kaucji — karta musi
 * pokazywać zera i myślniki, nie dziury. */
const NAZWA_NIEAKTYWNEGO = "Kurtyna świetlna LED 12 m — wycofana z oferty";

/**
 * WŁASNY operator tego speca — nie owner seeda. Logowanie panelu ma limit
 * 5/min NA KONTO (login/actions.ts, ADR-106), a wcześniejsze ogniwa łańcucha
 * (03, 04×2, 06, 08) logują ownera dokładnie 5 razy w oknie krótszym niż
 * minuta: szóste logowanie tym samym e-mailem jest odcinane i test wisiałby
 * na stronie logowania (dokładnie tak upadł pierwszy przebieg CI). Osobny
 * e-mail zeruje wymiar kontowy; wymiar IP (10/min) mieści sześć logowań.
 */
async function dosiejOperatora(
  tenantId: string,
  znacznik: number,
): Promise<{ email: string; password: string }> {
  const admin = adminClient();
  const email = `e2e-adr205-${znacznik}@example.com`;
  const password = `Adr205!${znacznik}`;

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { tenant_id: tenantId, role: "owner" },
  });
  if (created.error || !created.data.user) {
    throw new Error(`Nie dosiałem operatora: ${created.error?.message}`);
  }
  const { error } = await admin.from("members").insert({
    tenant_id: tenantId,
    user_id: created.data.user.id,
    role: "owner",
  });
  if (error) throw new Error(`Nie dosiałem członkostwa operatora: ${error.message}`);

  return { email, password };
}

/**
 * Dwa produkty W KSZTAŁCIE PRODUKCJI dosiane do tenanta seeda: seed K1 ma
 * jeden krótki produkt bez kaucji, a bramka ma obejrzeć także długą nazwę,
 * niezerową kaucję (szeroki zapis „1 200,00 zł") i wariant nieaktywny.
 */
async function dosiejProdukty(tenantId: string, znacznik: number): Promise<void> {
  const admin = adminClient();

  const { data: aktywny, error: bladAktywnego } = await admin
    .from("products")
    .insert({
      tenant_id: tenantId,
      name: DLUGA_NAZWA,
      description: "Produkt geometrii karty mobilnej (ADR-205).",
      base_price_day_grosze: 54_000,
      deposit_grosze: 120_000,
      buffer_before_days: 0,
      buffer_after_days: 0,
      active: true,
    })
    .select("id")
    .single();
  if (bladAktywnego || !aktywny) {
    throw new Error(`Nie dosiałem produktu aktywnego: ${bladAktywnego?.message}`);
  }
  for (let i = 1; i <= 2; i += 1) {
    const { error } = await admin.from("product_units").insert({
      tenant_id: tenantId,
      product_id: (aktywny as { id: string }).id,
      serial_number: `ADR205-${znacznik}-${i}`,
    });
    if (error) throw new Error(`Nie dosiałem egzemplarza: ${error.message}`);
  }

  const { error: bladNieaktywnego } = await admin.from("products").insert({
    tenant_id: tenantId,
    name: NAZWA_NIEAKTYWNEGO,
    description: "Produkt nieaktywny bez egzemplarzy (ADR-205).",
    base_price_day_grosze: 9_900,
    deposit_grosze: 0,
    buffer_before_days: 0,
    buffer_after_days: 0,
    active: false,
  });
  if (bladNieaktywnego) {
    throw new Error(`Nie dosiałem produktu nieaktywnego: ${bladNieaktywnego.message}`);
  }
}

type Pomiar = {
  okno: number;
  dostepna: number;
  wlasna: number;
  zmierzonychElementow: number;
  najszerszy: string;
  widziTresc: boolean;
  kartyWidoczne: number;
  wierszeTabeliWidoczne: number;
};

/**
 * Sonda geometrii i widoczności wariantów. Wykonuje się W STRONIE, więc
 * czyta prawdziwy layout silnika, a nie nasze wyobrażenie o nim.
 *
 * Szerokość DOSTĘPNA = pole treści kontenera panelu (clientWidth minus
 * padding): kontener sam ma padding, więc jego clientWidth zawiera piksele,
 * w których treść stać nie może. Mierzeni są POTOMKOWIE kontenera.
 */
async function zmierz(page: Page, okno: number, nazwy: string[]): Promise<Pomiar> {
  await page.setViewportSize({ width: okno, height: 900 });
  // Zmiana okna przelicza layout dopiero w kolejnej klatce — bez tego pomiar
  // bywa z poprzedniej szerokości.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

  return page.evaluate((oczekiwaneNazwy) => {
    const kontener = document.querySelector("[data-panel-container]");
    if (!(kontener instanceof HTMLElement)) {
      throw new Error("Nie znalazłem kontenera panelu (data-panel-container).");
    }
    const styl = getComputedStyle(kontener);
    const dostepna =
      kontener.clientWidth - parseFloat(styl.paddingLeft) - parseFloat(styl.paddingRight);

    // Element w poddrzewie z display:none ma zerowe prostokąty i zerowy
    // scrollWidth, więc ukryty wariant NIE zaniża i NIE zawyża pomiaru —
    // mierzony jest wyłącznie wariant, który operator widzi.
    const elementy = [...kontener.querySelectorAll("*")] as HTMLElement[];
    let wlasna = 0;
    let najszerszy = "";
    for (const element of elementy) {
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

    // Widoczność wariantów: `offsetParent === null` = element (albo przodek)
    // ma display:none — dokładnie mechanika progu `md:` Tailwinda.
    const widocznych = (selektor: string) =>
      [...document.querySelectorAll(selektor)].filter(
        (element) => (element as HTMLElement).offsetParent !== null,
      ).length;

    const tekst = kontener.textContent ?? "";
    return {
      okno: window.innerWidth,
      dostepna,
      wlasna,
      zmierzonychElementow: elementy.length,
      najszerszy,
      widziTresc: oczekiwaneNazwy.every((nazwa) => tekst.includes(nazwa)),
      kartyWidoczne: widocznych("[data-product-card]"),
      wierszeTabeliWidoczne: widocznych("[data-product-row]"),
    };
  }, nazwy);
}

test("katalog na telefonie to karty mieszczące się w oknie, na desktopie tabela (ADR-205)", async ({
  page,
}) => {
  const seed = readSeedState();
  const znacznik = Date.now();
  const operator = await dosiejOperatora(seed.tenantId, znacznik);
  await dosiejProdukty(seed.tenantId, znacznik);

  // Logowanie WŁASNYM kontem — patrz `dosiejOperatora`: szóste logowanie
  // e-mailem ownera wpada w limit 5/min na konto.
  await loginToPanel(page, PANEL_URL, {
    ...seed,
    ownerEmail: operator.email,
    ownerPassword: operator.password,
  });
  await page.goto(`${PANEL_URL}/pl/katalog`);
  // Jawny, hojny budżet: lista robi kilka odczytów na żądanie, a runner bywa
  // dzielony z innymi przebiegami.
  await expect(page.locator("[data-product-card]").first()).toBeAttached({ timeout: 30_000 });

  const nazwy = [seed.productName, DLUGA_NAZWA, NAZWA_NIEAKTYWNEGO];
  const telefon = await zmierz(page, 390, nazwy);
  const desktop = await zmierz(page, 1440, nazwy);

  // Raport wchodzi do logu ZAWSZE — jest dowodem pomiarowym zadania, a nie
  // tylko diagnostyką porażki.
  for (const p of [telefon, desktop]) {
    console.log(
      `[ADR-205] okno ${p.okno} px → własna ${p.wlasna} px / dostępna ${p.dostepna} px ` +
        `(${p.wlasna <= p.dostepna ? "MIEŚCI SIĘ" : `PRZEPEŁNIA o ${p.wlasna - p.dostepna} px`}` +
        `, najszerszy: ${p.najszerszy}, zmierzonych: ${p.zmierzonychElementow}, ` +
        `kart widocznych: ${p.kartyWidoczne}, wierszy tabeli widocznych: ${p.wierszeTabeliWidoczne})`,
    );
  }

  // KONTROLA PRZYRZĄDU najpierw: zieleń na pustym zbiorze albo na cudzym
  // ekranie niczego nie dowodzi.
  for (const pomiar of [telefon, desktop]) {
    expect(
      pomiar.widziTresc,
      `okno ${pomiar.okno} px: sonda nie widzi zasianych produktów — mierzy nie to, co trzeba`,
    ).toBe(true);
    expect(
      pomiar.zmierzonychElementow,
      `okno ${pomiar.okno} px: sonda zmierzyła podejrzanie mało elementów`,
    ).toBeGreaterThan(30);
    expect(pomiar.dostepna, `okno ${pomiar.okno} px: kolumna ma zerową szerokość`).toBeGreaterThan(
      200,
    );
  }

  // ── Telefon (390 px): karty widoczne, tabela nie, wszystko się mieści. ──
  expect(telefon.kartyWidoczne, "telefon: brak widocznych kart produktów").toBeGreaterThanOrEqual(
    3,
  );
  expect(
    telefon.wierszeTabeliWidoczne,
    "telefon: tabela desktopowa jest widoczna obok kart (podwójny render)",
  ).toBe(0);
  expect(
    telefon.wlasna,
    `telefon: katalog ma ${telefon.wlasna} px przy ${telefon.dostepna} px dostępnych ` +
      `(najszerszy element: ${telefon.najszerszy})`,
  ).toBeLessThanOrEqual(telefon.dostepna);

  // ── Desktop (1440 px): tabela widoczna, karty nie. Geometrii tabeli NIE
  //    asertujemy — patrz nagłówek pliku. ──
  expect(desktop.wierszeTabeliWidoczne, "desktop: tabela zniknęła").toBeGreaterThanOrEqual(3);
  expect(
    desktop.kartyWidoczne,
    "desktop: karty mobilne widoczne obok tabeli (podwójny render)",
  ).toBe(0);
});
