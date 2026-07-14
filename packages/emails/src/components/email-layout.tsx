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

import { EMAIL_STYLES } from "../styles";

const PRODUCT_NAME = "<NAZWA>";

export interface EmailLayoutProps {
  children: ReactNode;
  cta: {
    href: string;
    label: string;
  };
  heading: string;
  previewText: string;
}

export function EmailLayout({
  children,
  cta,
  heading,
  previewText,
}: EmailLayoutProps) {
  return (
    <Html lang="pl">
      <Head />
      <Preview>{previewText}</Preview>
      <Body lang="pl" style={EMAIL_STYLES.body}>
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
              Jeśli przycisk nie działa, skopiuj ten link do przeglądarki:
              <br />
              <Link href={cta.href} style={EMAIL_STYLES.fallbackLink}>
                {cta.href}
              </Link>
            </Text>
            <Hr style={EMAIL_STYLES.divider} />
            <Text style={EMAIL_STYLES.footer}>
              {PRODUCT_NAME} · platforma do zarządzania wynajmem
              <br />
              To wiadomość automatyczna dotycząca Twojego konta.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
