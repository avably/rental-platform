import { PRODUCT_NAME, bcp47, type Locale } from "@avably/core";
import type { ReactNode } from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "react-email";

import { emailMessages } from "../messages";
import { EMAIL_STYLES } from "../styles";

export interface EmailLayoutProps {
  children: ReactNode;
  cta: {
    href: string;
    label: string;
  };
  heading: string;
  /** Język odbiorcy — steruje treścią ramki i atrybutem `lang`. */
  locale: Locale;
  previewText: string;
}

export function EmailLayout({
  children,
  cta,
  heading,
  locale,
  previewText,
}: EmailLayoutProps) {
  const t = emailMessages(locale).layout;
  const lang = bcp47(locale);

  return (
    <Html lang={lang}>
      <Head />
      <Preview>{previewText}</Preview>
      <Body lang={lang} style={EMAIL_STYLES.body}>
        <Container style={EMAIL_STYLES.container}>
          <Section style={EMAIL_STYLES.card}>
            <Text style={EMAIL_STYLES.brand}>{PRODUCT_NAME}</Text>
            <Heading as="h1" style={EMAIL_STYLES.heading}>
              {heading}
            </Heading>
            {children}
            <Section style={EMAIL_STYLES.ctaSection}>
              <Button href={cta.href} style={EMAIL_STYLES.button}>
                {cta.label}
              </Button>
            </Section>
            <Text style={EMAIL_STYLES.fallbackText}>
              {t.fallbackHint}
              <br />
              <Link href={cta.href} style={EMAIL_STYLES.fallbackLink}>
                {cta.href}
              </Link>
            </Text>
            <Hr style={EMAIL_STYLES.divider} />
            <Text style={EMAIL_STYLES.footer}>
              {PRODUCT_NAME} · {t.footerTagline}
              <br />
              {t.footerAutomated}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
