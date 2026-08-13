import type enMessages from "@/messages/en.json";

type PrivacyCopy = typeof enMessages.privacy;

/**
 * Treść polityki prywatności — wyspa Reacta na stronie przeniesionej z szablonu
 * (ADR-068). Znaczniki są te same, których używa richtext szablonu — h6 na
 * nagłówki sekcji i akapity — więc typografia zostaje jego.
 *
 * WYSPA NIESIE WŁASNĄ SEKCJĘ I WŁASNY KONTENER (ADR-162), bo `MarketingPageView`
 * tnie HTML szablonu na znaczniku wyspy i podaje obie połówki osobnym
 * `dangerouslySetInnerHTML`. Dopóki znacznik siedział WEWNĄTRZ siatki
 * `.legal-halves`, pierwsza połówka kończyła się w środku drzewa, parser
 * domykał ją sam, a treść lądowała jako rodzeństwo `.marketing-static` — poza
 * `.main-container`, czyli przy krawędzi ekranu (zmierzone przy 375 px:
 * x = 0 px wobec x = 16 px nagłówka strony). Dziś znacznik stoi między
 * sekcjami, obie połówki są zamkniętym drzewem, a kontener przynosi wyspa.
 * Kontener jest TEN SAM, co pod nagłówkiem strony (`main-container`), więc obie
 * części dokumentu trzymają jedną krawędź na każdej szerokości okna; długość
 * wiersza ogranicza `.body-legal` w `avably-marketing.css`, nie kontener.
 */
export function PrivacyContent({ copy }: { copy: PrivacyCopy }) {
  return (
    <section className="section legal-body-section">
      <div className="w-layout-blockcontainer main-container w-container">
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
      </div>
    </section>
  );
}
