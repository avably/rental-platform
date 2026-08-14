import React from "react";
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import { HtmlContent, looksLikeHtml } from "./html-to-pdf";
import { CONTRACT_LABELS } from "./labels";
import { contractLogoImage } from "./logo";
import { formatMoney } from "./money";
import type { ContractCustomField, ContractPdfProps } from "./types";

// Finalna paleta Avably — wartości z sekcji 01 artefaktu Fazy 2.
const INK = "#0B1017";
const MUTED = "#55616D";
const CANVAS = "#F4F6F5";
const BORDER = "#7E8994";
const LIME = "#EAFFA4";
const SIGNAL_STRONG = "#5F7500";

const styles = StyleSheet.create({
  page: {
    paddingTop: 35,
    paddingBottom: 55,
    paddingHorizontal: 40,
    fontSize: 9.5,
    fontFamily: "Roboto",
    lineHeight: 1.5,
    color: INK,
  },
  headerBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
    paddingBottom: 10,
    borderBottom: `2 solid ${SIGNAL_STRONG}`,
  },
  title: { fontSize: 14, fontWeight: 700, color: INK, letterSpacing: 0.5 },
  /**
   * Pudełko znaku najemcy (ADR-175) — lustro roli `.site-logo` ze sklepu
   * (ADR-160, decyzja 6), przeliczone na punkty PDF: 27 pt ≈ 36 px, 144 pt
   * ≈ 192 px. `objectFit: "contain"` trzyma proporcje, więc plik 3000 × 200
   * mieści się w tej samej ramce co kwadratowy i nie rozpycha nagłówka.
   */
  headerLogo: { height: 27, maxWidth: 144, objectFit: "contain", marginBottom: 6 },
  headerMeta: { fontSize: 8, color: MUTED, marginTop: 2 },
  headerRight: { alignItems: "flex-end" },
  orderBadge: {
    backgroundColor: LIME,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 3,
    marginBottom: 3,
  },
  orderBadgeText: { fontSize: 9, fontWeight: 700, color: INK, letterSpacing: 0.3 },
  section: { marginBottom: 12 },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 700,
    marginBottom: 6,
    color: INK,
    paddingBottom: 3,
    borderBottom: `1 solid ${BORDER}`,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  partiesRow: { flexDirection: "row", gap: 12, marginBottom: 4 },
  partyBox: { flex: 1, backgroundColor: CANVAS, borderRadius: 4, padding: 8 },
  partyLabel: {
    fontSize: 7.5,
    fontWeight: 700,
    color: SIGNAL_STRONG,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  tableContainer: { backgroundColor: CANVAS, borderRadius: 4, padding: 8, marginBottom: 4 },
  row: { flexDirection: "row", marginBottom: 3 },
  label: { width: "38%", color: MUTED, fontSize: 8.5 },
  value: { width: "62%", fontWeight: 700, fontSize: 9 },
  itemRow: { flexDirection: "row", alignItems: "center", marginBottom: 3 },
  itemName: { width: "35%", fontSize: 8.5, fontWeight: 700 },
  itemSerial: { width: "27%", fontSize: 8, color: MUTED },
  itemRental: { width: "19%", fontSize: 8.5, fontWeight: 700, textAlign: "right" },
  itemDeposit: { width: "19%", fontSize: 7.5, color: MUTED, textAlign: "right" },
  chargeRow: { flexDirection: "row", marginBottom: 3 },
  chargeLabel: { width: "60%", color: MUTED, fontSize: 9 },
  chargeValue: { width: "40%", fontWeight: 700, fontSize: 9.5, textAlign: "right" },
  signaturesRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 24, paddingTop: 12 },
  signatureBox: { width: "40%", alignItems: "center" },
  signatureLine: { borderBottom: `1 solid ${INK}`, width: "100%", marginBottom: 4 },
  signatureName: { fontSize: 9, color: INK, textAlign: "center", marginTop: 2 },
  signatureLabel: { fontSize: 7.5, color: MUTED, textAlign: "center" },
  legalPage: {
    paddingTop: 35,
    paddingBottom: 55,
    paddingHorizontal: 40,
    fontSize: 8,
    fontFamily: "Roboto",
    lineHeight: 1.5,
    color: INK,
  },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 40,
    right: 40,
    paddingTop: 8,
    borderTop: `1 solid ${BORDER}`,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  footerText: { fontSize: 7, color: MUTED },
  customGroup: { marginBottom: 6 },
  customGroupLabel: {
    fontSize: 7.5,
    fontWeight: 700,
    color: SIGNAL_STRONG,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  itemCustomRow: { flexDirection: "row", marginBottom: 2, paddingLeft: 8 },
  itemCustomLabel: { width: "35%", fontSize: 7.5, color: MUTED },
  itemCustomValue: { width: "65%", fontSize: 7.5 },
});

function LabeledRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

/**
 * Grupa pól własnych: nagłówek + pary etykieta→wartość.
 *
 * Wartość idzie do `<Text>` JAKO DZIECKO, nigdy przez `HtmlContent` i nigdy
 * przez sklejanie znacznika ze stringa. To jest cała ochrona tej powierzchni
 * i jest ona strukturalna: `<Text>{value}</Text>` nie ma drogi, którą treść
 * mogłaby stać się instrukcją — ani formatu PDF, ani HTML-a. Regulamin
 * (`terms.body`) jedzie parserem HTML świadomie, bo pisze go WŁAŚCICIEL
 * w edytorze; pole własne wypełnia lada, a przy polach checkoutowych — klient
 * końcowy, więc te dwie ścieżki nie mogą się zejść.
 */
function CustomFieldGroup({ heading, rows }: {
  heading: string;
  rows: readonly ContractCustomField[];
}): React.ReactElement | null {
  if (rows.length === 0) return null;
  return (
    <View style={styles.customGroup}>
      <Text style={styles.customGroupLabel}>{heading}</Text>
      {rows.map((row, idx) => (
        <LabeledRow key={idx} label={row.label} value={row.value} />
      ))}
    </View>
  );
}

function Footer({ tenantName, orderNumber, note }: {
  tenantName: string;
  orderNumber: string;
  note: string;
}): React.ReactElement {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>{`${tenantName} · ${note}`}</Text>
      <Text style={styles.footerText}>{orderNumber}</Text>
    </View>
  );
}

/**
 * Umowa najmu jako dokument @react-pdf. Czyste dane wejściowe → PDF.
 * Bez `new Date()`, `Math.random()`, `process.env` — determinizm renderu jest
 * warunkiem stabilności snapshotów; wszystko zmienne przychodzi w propsach.
 */
export function ContractDocument(props: ContractPdfProps): React.JSX.Element {
  const { locale, tenant, customer, order, items, totals, terms } = props;
  const t = CONTRACT_LABELS[locale];
  const currency = totals.currency;
  const money = (grosze: number): string => formatMoney(grosze, currency, locale);

  const customerFields = props.customFields?.customer ?? [];
  const orderFields = props.customFields?.order ?? [];
  // Sekcja dodatkowa istnieje TYLKO wtedy, gdy ma co pokazać — a numeracja
  // paragrafów idzie za nią. Najemca bez pól własnych dostaje umowę
  // NIEODRÓŻNIALNĄ od tej sprzed C6-A2 (regulamin zostaje §5), więc nowa
  // powierzchnia nie przestawia dokumentów, do których nikt jej nie zamówił.
  const hasExtras = customerFields.length > 0 || orderFields.length > 0;
  const termsNumber = hasExtras ? 6 : 5;
  // ZNAK NAJEMCY (ADR-175). Decyzja o obrazie zapada TUTAJ, z propsów, a nie
  // wewnątrz `<Image>`: renderer połyka nieczytelny plik ostrzeżeniem na
  // konsoli i rysuje stronę bez obrazu, więc zdanie się na niego znaczyłoby
  // dziurę w nagłówku zamiast fallbacku (patrz `logo.ts`).
  const mark = contractLogoImage(tenant.logo);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* ── Nagłówek ── */}
        <View style={styles.headerBar}>
          <View>
            {/*
              Znak stoi NAD tytułem i niczego nie zastępuje. To jest różnica
              wobec e-maila, gdzie zajmuje miejsce napisu z nazwą: tam nazwa
              jest MARKĄ nadawcy, a tutaj TREŚCIĄ umowy — wynajmującym. Nazwa
              wynajmującego nie znika z dokumentu nigdy, więc najemca bez znaku
              dostaje nagłówek co do znaku taki sam jak przed tą zmianą.
            */}
            {mark ? <Image src={mark} style={styles.headerLogo} /> : null}
            <Text style={styles.title}>{t.documentTitle}</Text>
            <Text style={styles.headerMeta}>{`${tenant.name} · ${tenant.email}`}</Text>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.orderBadge}>
              <Text style={styles.orderBadgeText}>{order.number}</Text>
            </View>
          </View>
        </View>

        {/* ── §1 Strony umowy ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{`§1 ${t.parties}`}</Text>
          <View style={styles.partiesRow}>
            <View style={styles.partyBox}>
              <Text style={styles.partyLabel}>{t.lessor}</Text>
              <LabeledRow label={t.company} value={tenant.name} />
              {tenant.nip ? <LabeledRow label={t.taxId} value={tenant.nip} /> : null}
              <LabeledRow label={t.address} value={tenant.address} />
              <LabeledRow label={t.email} value={tenant.email} />
            </View>
            <View style={styles.partyBox}>
              <Text style={styles.partyLabel}>{t.lessee}</Text>
              <LabeledRow label={t.fullName} value={customer.fullName} />
              {customer.address ? <LabeledRow label={t.address} value={customer.address} /> : null}
              <LabeledRow label={t.email} value={customer.email} />
            </View>
          </View>
        </View>

        {/* ── §2 Przedmiot najmu ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{`§2 ${t.subject}`}</Text>
          {items.length > 0 ? (
            <View style={styles.tableContainer}>
              {items.map((item, idx) => (
                <View key={idx}>
                  <View style={styles.itemRow}>
                    <Text style={styles.itemName}>{item.name}</Text>
                    <Text style={styles.itemSerial}>
                      {item.serialNumber ? `${t.serialNumber}: ${item.serialNumber}` : ""}
                    </Text>
                    <Text style={styles.itemRental}>{`${t.itemRental}: ${money(item.rentalGrosze)}`}</Text>
                    <Text style={styles.itemDeposit}>{`${t.itemDeposit}: ${money(item.depositGrosze)}`}</Text>
                  </View>
                  {/* Pola własne produktu — pod pozycją, której dotyczą. */}
                  {(item.customFields ?? []).map((field, fieldIdx) => (
                    <View key={fieldIdx} style={styles.itemCustomRow}>
                      <Text style={styles.itemCustomLabel}>{field.label}</Text>
                      <Text style={styles.itemCustomValue}>{field.value}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          ) : (
            <Text style={{ fontSize: 8.5, color: MUTED }}>{t.noItems}</Text>
          )}
        </View>

        {/* ── §3 Okres najmu ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{`§3 ${t.period}`}</Text>
          <View style={styles.tableContainer}>
            <LabeledRow label={t.startDate} value={order.startDate} />
            <LabeledRow label={t.endDate} value={order.endDate} />
            <LabeledRow label={t.days} value={String(order.days)} />
          </View>
        </View>

        {/* ── §4 Wynagrodzenie i kaucja ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{`§4 ${t.charges}`}</Text>
          <View style={styles.tableContainer}>
            <View style={styles.chargeRow}>
              <Text style={styles.chargeLabel}>{t.rentalFee}</Text>
              <Text style={styles.chargeValue}>{money(totals.rentalGrosze)}</Text>
            </View>
            <View style={styles.chargeRow}>
              <Text style={styles.chargeLabel}>{t.deposit}</Text>
              <Text style={styles.chargeValue}>{money(totals.depositGrosze)}</Text>
            </View>
            <View style={styles.chargeRow}>
              <Text style={styles.chargeLabel}>{t.delivery}</Text>
              <Text style={styles.chargeValue}>{money(totals.deliveryGrosze)}</Text>
            </View>
          </View>
        </View>

        {/* ── §5 Dane dodatkowe (pola własne najemcy) — tylko gdy są ── */}
        {hasExtras ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{`§5 ${t.additionalDetails}`}</Text>
            <View style={styles.tableContainer}>
              <CustomFieldGroup heading={t.customerDetails} rows={customerFields} />
              <CustomFieldGroup heading={t.orderDetails} rows={orderFields} />
            </View>
          </View>
        ) : null}

        {/* ── Podpisy ── */}
        <View style={styles.signaturesRow}>
          <View style={styles.signatureBox}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureName}>{tenant.name}</Text>
            <Text style={styles.signatureLabel}>{t.lessor}</Text>
          </View>
          <View style={styles.signatureBox}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureName}>{customer.fullName}</Text>
            <Text style={styles.signatureLabel}>{t.lessee}</Text>
          </View>
        </View>

        <Footer tenantName={tenant.name} orderNumber={order.number} note={t.generatedNote} />
      </Page>

      {/* ── Regulamin — osobna strona ── */}
      <Page size="A4" style={styles.legalPage}>
        <View style={{ marginBottom: 8 }}>
          <Text style={styles.sectionTitle}>
            {`§${termsNumber} ${t.terms} — ${t.termsVersion} ${terms.version}`}
          </Text>
        </View>

        {looksLikeHtml(terms.body) ? (
          <HtmlContent html={terms.body} />
        ) : (
          terms.body
            .split("\n\n")
            .map((paragraph) => paragraph.trim())
            .filter(Boolean)
            .map((paragraph, i) => (
              <Text key={i} style={{ fontSize: 8, lineHeight: 1.5, marginBottom: 4, textAlign: "justify" }}>
                {paragraph}
              </Text>
            ))
        )}

        <Footer tenantName={tenant.name} orderNumber={order.number} note={t.generatedNote} />
      </Page>
    </Document>
  );
}
