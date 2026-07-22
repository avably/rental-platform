import type enMessages from "@/messages/en.json";

type PrivacyCopy = typeof enMessages.privacy;

/**
 * Treść polityki prywatności wstawiana w blok `.body-legal` szablonu
 * (ADR-068). Znaczniki są te same, których używa richtext szablonu — h6 na
 * nagłówki sekcji i akapity — więc typografia zostaje jego.
 */
export function PrivacyContent({ copy }: { copy: PrivacyCopy }) {
  return (
    <div className="body-legal w-richtext">
      <p>
        {copy.updatedLabel} {copy.updatedValue}
      </p>
      {copy.sections.map((section) => (
        <div key={section.heading}>
          <h6>{section.heading}</h6>
          {section.body.map((paragraph) => (
            <p key={paragraph} style={{ whiteSpace: "pre-line" }}>
              {paragraph}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}
