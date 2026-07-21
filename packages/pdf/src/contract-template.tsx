import React from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import { HtmlContent, looksLikeHtml } from "./html-to-pdf";
import { CONTRACT_LABELS } from "./labels";
import { formatMoney } from "./money";
import type { ContractPdfProps } from "./types";

// Paleta portowana z lib/pdf/ContractTemplate.tsx (starkit-system).
const GOLD = "#D4A843";
const DARK = "#1e293b";
const GRAY = "#64748b";
const LIGHT_BG = "#f8fafc";
const BORDER = "#e2e8f0";

const styles = StyleSheet.create({
  page: {
    paddingTop: 35,
    paddingBottom: 55,
    paddingHorizontal: 40,
    fontSize: 9.5,
    fontFamily: "Roboto",
    lineHeight: 1.5,
    color: DARK,
  },
  headerBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
    paddingBottom: 10,
    borderBottom: `2 solid ${GOLD}`,
  },
  title: { fontSize: 14, fontWeight: 700, color: DARK, letterSpacing: 0.5 },
  headerMeta: { fontSize: 8, color: GRAY, marginTop: 2 },
  headerRight: { alignItems: "flex-end" },
  orderBadge: {
    backgroundColor: GOLD,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 3,
    marginBottom: 3,
  },
  orderBadgeText: { fontSize: 9, fontWeight: 700, color: "#ffffff", letterSpacing: 0.3 },
  section: { marginBottom: 12 },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 700,
    marginBottom: 6,
    color: DARK,
    paddingBottom: 3,
    borderBottom: `1 solid ${BORDER}`,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  partiesRow: { flexDirection: "row", gap: 12, marginBottom: 4 },
  partyBox: { flex: 1, backgroundColor: LIGHT_BG, borderRadius: 4, padding: 8 },
  partyLabel: {
    fontSize: 7.5,
    fontWeight: 700,
    color: GOLD,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  tableContainer: { backgroundColor: LIGHT_BG, borderRadius: 4, padding: 8, marginBottom: 4 },
  row: { flexDirection: "row", marginBottom: 3 },
  label: { width: "38%", color: GRAY, fontSize: 8.5 },
  value: { width: "62%", fontWeight: 700, fontSize: 9 },
  itemRow: { flexDirection: "row", alignItems: "center", marginBottom: 3 },
  itemName: { width: "35%", fontSize: 8.5, fontWeight: 700 },
  itemSerial: { width: "27%", fontSize: 8, color: GRAY },
  itemRental: { width: "19%", fontSize: 8.5, fontWeight: 700, textAlign: "right" },
  itemDeposit: { width: "19%", fontSize: 7.5, color: GRAY, textAlign: "right" },
  chargeRow: { flexDirection: "row", marginBottom: 3 },
  chargeLabel: { width: "60%", color: GRAY, fontSize: 9 },
  chargeValue: { width: "40%", fontWeight: 700, fontSize: 9.5, textAlign: "right" },
  signaturesRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 24, paddingTop: 12 },
  signatureBox: { width: "40%", alignItems: "center" },
  signatureLine: { borderBottom: `1 solid ${DARK}`, width: "100%", marginBottom: 4 },
  signatureName: { fontSize: 9, color: DARK, textAlign: "center", marginTop: 2 },
  signatureLabel: { fontSize: 7.5, color: GRAY, textAlign: "center" },
  legalPage: {
    paddingTop: 35,
    paddingBottom: 55,
    paddingHorizontal: 40,
    fontSize: 8,
    fontFamily: "Roboto",
    lineHeight: 1.5,
    color: DARK,
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
  footerText: { fontSize: 7, color: GRAY },
});

function LabeledRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
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

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* ── Nagłówek ── */}
        <View style={styles.headerBar}>
          <View>
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
                <View key={idx} style={styles.itemRow}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  <Text style={styles.itemSerial}>
                    {item.serialNumber ? `${t.serialNumber}: ${item.serialNumber}` : ""}
                  </Text>
                  <Text style={styles.itemRental}>{`${t.itemRental}: ${money(item.rentalGrosze)}`}</Text>
                  <Text style={styles.itemDeposit}>{`${t.itemDeposit}: ${money(item.depositGrosze)}`}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={{ fontSize: 8.5, color: GRAY }}>{t.noItems}</Text>
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

      {/* ── §5 Regulamin — osobna strona ── */}
      <Page size="A4" style={styles.legalPage}>
        <View style={{ marginBottom: 8 }}>
          <Text style={styles.sectionTitle}>{`§5 ${t.terms} — ${t.termsVersion} ${terms.version}`}</Text>
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
