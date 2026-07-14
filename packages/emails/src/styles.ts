import type { CSSProperties } from "react";

export const EMAIL_COLORS = {
  background: "#ffffff",
  foreground: "#0a0a0a",
  primary: "#171717",
  primaryForeground: "#fafafa",
  muted: "#f7f7f7",
  mutedForeground: "#555555",
  border: "#e8e8e8",
} as const;

export const EMAIL_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';

export const EMAIL_STYLES = {
  body: {
    backgroundColor: EMAIL_COLORS.muted,
    color: EMAIL_COLORS.foreground,
    fontFamily: EMAIL_FONT_FAMILY,
    margin: "0",
    padding: "0",
  },
  container: {
    margin: "0 auto",
    maxWidth: "600px",
    padding: "40px 20px 24px",
    width: "100%",
  },
  card: {
    backgroundColor: EMAIL_COLORS.background,
    border: `1px solid ${EMAIL_COLORS.border}`,
    borderRadius: "10px",
    padding: "32px",
  },
  brand: {
    color: EMAIL_COLORS.foreground,
    fontSize: "18px",
    fontWeight: "700",
    letterSpacing: "-0.01em",
    margin: "0 0 28px",
  },
  heading: {
    color: EMAIL_COLORS.foreground,
    fontSize: "24px",
    fontWeight: "700",
    letterSpacing: "-0.02em",
    lineHeight: "1.3",
    margin: "0 0 20px",
  },
  text: {
    color: EMAIL_COLORS.foreground,
    fontSize: "15px",
    lineHeight: "1.65",
    margin: "0 0 16px",
  },
  ctaSection: {
    margin: "28px 0 20px",
    textAlign: "center",
  },
  button: {
    backgroundColor: EMAIL_COLORS.primary,
    borderRadius: "8px",
    color: EMAIL_COLORS.primaryForeground,
    display: "inline-block",
    fontSize: "15px",
    fontWeight: "600",
    lineHeight: "1",
    padding: "14px 22px",
    textDecoration: "none",
  },
  fallbackText: {
    color: EMAIL_COLORS.mutedForeground,
    fontSize: "12px",
    lineHeight: "1.6",
    margin: "0",
  },
  fallbackLink: {
    color: EMAIL_COLORS.foreground,
    textDecoration: "underline",
    wordBreak: "break-all",
  },
  divider: {
    borderColor: EMAIL_COLORS.border,
    margin: "28px 0 20px",
  },
  footer: {
    color: EMAIL_COLORS.mutedForeground,
    fontSize: "12px",
    lineHeight: "1.6",
    margin: "0",
    textAlign: "center",
  },
} satisfies Record<string, CSSProperties>;
