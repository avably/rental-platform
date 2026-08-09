<?php
/**
 * Pola własne najemcy we wtyczce (C6-A3, ADR-121): render formularza,
 * przepuszczanie wartości do body kontraktu i komunikaty odmów.
 *
 * DWIE GRANICE, KTÓRE TU DOWODZIMY:
 *   * wtyczka renderuje wyłącznie pola, które klient MA prawo wypełnić —
 *     encja `product` opisuje sprzęt i należy do operatora;
 *   * wtyczka nie jest bramką i nie udaje bramki: sprawdza KSZTAŁT (klucz to
 *     identyfikator, wartość to skalar rozsądnej długości), a o istnieniu
 *     pola i zgodności wartości z definicją rozstrzyga serwer.
 */

use PHPUnit\Framework\TestCase;

final class CustomFieldsTest extends TestCase {

	private const PRODUCT  = '2a2a2a2a-1111-4222-8333-444444444444';
	private const CF_TEXT  = '11111111-1111-4111-8111-111111111111';
	private const CF_SEL   = '22222222-2222-4222-8222-222222222222';
	private const CF_CHECK = '33333333-3333-4333-8333-333333333333';
	private const CF_PROD  = '44444444-4444-4444-8444-444444444444';

	private function definition( string $id, string $type, array $overrides = array() ): array {
		return array_merge(
			array(
				'id'         => $id,
				'entity'     => 'order',
				'field_type' => $type,
				'label'      => 'Numer uprawnień',
				'help_text'  => null,
				'required'   => false,
				'options'    => array(),
			),
			$overrides
		);
	}

	private function catalog( array $definitions ): array {
		return array(
			'tenant'           => array( 'name' => 'Wypożyczalnia', 'locale' => 'pl', 'currency' => 'PLN' ),
			'custom_fields'    => $definitions,
			'products'         => array(),
			'pickup_locations' => array(),
			'delivery_methods' => array( array( 'method' => 'courier', 'price_grosze' => 1500 ) ),
		);
	}

	private function product(): array {
		return array(
			'id'                    => self::PRODUCT,
			'name'                  => 'Wiertarka',
			'description'           => '',
			'base_price_day_grosze' => 12000,
			'deposit_grosze'        => 30000,
		);
	}

	private function render( array $definitions ): string {
		return Avably_Booking_Renderer::render_product(
			$this->product(),
			$this->catalog( $definitions ),
			'https://example.test/wypozyczalnia'
		);
	}

	// -----------------------------------------------------------------
	// Render
	// -----------------------------------------------------------------

	public function test_renders_field_with_contract_key_as_name_and_field_marker(): void {
		$html = $this->render( array( $this->definition( self::CF_TEXT, 'text' ) ) );

		$this->assertStringContainsString( 'name="cf_' . self::CF_TEXT . '"', $html );
		// `data-avably-field` niesie DOKŁADNIE ten klucz, którym API odsyła
		// błędy — bez tego showFieldErrors nie znajdzie pola i komunikat
		// przepadłby po cichu.
		$this->assertStringContainsString( 'data-avably-field="cf_' . self::CF_TEXT . '"', $html );
		$this->assertStringContainsString( 'Numer uprawnień', $html );
	}

	public function test_required_definition_renders_required_control(): void {
		$html = $this->render(
			array( $this->definition( self::CF_TEXT, 'text', array( 'required' => true ) ) )
		);
		$this->assertMatchesRegularExpression(
			'/name="cf_' . self::CF_TEXT . '"[^>]* required/',
			$html
		);
	}

	public function test_select_renders_options_from_definition(): void {
		$html = $this->render(
			array(
				$this->definition(
					self::CF_SEL,
					'select',
					array( 'options' => array( 'Alfa', 'Beta' ) )
				),
			)
		);
		$this->assertStringContainsString( '<option value="Alfa">Alfa</option>', $html );
		$this->assertStringContainsString( '<option value="Beta">Beta</option>', $html );
	}

	public function test_checkbox_renders_as_checkbox_with_value_one(): void {
		$html = $this->render( array( $this->definition( self::CF_CHECK, 'checkbox' ) ) );
		$this->assertMatchesRegularExpression(
			'/<input type="checkbox" value="1"[^>]*name="cf_' . self::CF_CHECK . '"/',
			$html
		);
	}

	/**
	 * NAJCIEKAWSZY WEKTOR ZADANIA od strony wtyczki: definicja produktu
	 * z flagą „zamawianie" JEST w odpowiedzi API (konsument potrzebuje jej
	 * etykiety do opisania wartości przy produkcie), ale NIE JEST polem
	 * do wypełnienia. Formularz nie ma prawa jej pokazać.
	 */
	public function test_product_entity_definition_is_not_rendered_as_input(): void {
		$html = $this->render(
			array( $this->definition( self::CF_PROD, 'text', array( 'entity' => 'product', 'label' => 'Numer seryjny' ) ) )
		);
		$this->assertStringNotContainsString( 'cf_' . self::CF_PROD, $html );
		$this->assertStringNotContainsString( 'Numer seryjny', $html );
	}

	public function test_unknown_field_type_is_skipped_instead_of_guessed(): void {
		// Wtyczka starsza od schematu: zgadnięta kontrolka wysyłałaby wartość,
		// której serwer i tak nie przyjmie — lepiej nie pokazać pola.
		$html = $this->render( array( $this->definition( self::CF_TEXT, 'file' ) ) );
		$this->assertStringNotContainsString( 'cf_' . self::CF_TEXT, $html );
	}

	public function test_hostile_label_and_option_are_escaped(): void {
		$html = $this->render(
			array(
				$this->definition(
					self::CF_SEL,
					'select',
					array(
						'label'   => '<script>alert(1)</script>',
						'options' => array( '"><img src=x onerror=alert(1)>' ),
					)
				),
			)
		);
		$this->assertStringNotContainsString( '<script>alert(1)</script>', $html );
		$this->assertStringNotContainsString( '<img src=x', $html );
		$this->assertStringContainsString( '&lt;script&gt;', $html );
	}

	public function test_no_definitions_render_no_markup(): void {
		$this->assertStringNotContainsString( 'cf_', $this->render( array() ) );
	}

	// -----------------------------------------------------------------
	// Walidator / body kontraktu
	// -----------------------------------------------------------------

	private function valid_input( array $overrides = array() ): array {
		return array_merge(
			array(
				'email'           => 'jan@example.com',
				'full_name'       => 'Jan Kowalski',
				'product_id'      => self::PRODUCT,
				'quantity'        => '1',
				'start_date'      => '2026-09-01',
				'end_date'        => '2026-09-03',
				'delivery_method' => 'courier',
				'payment_method'  => 'transfer',
				'terms_accepted'  => '1',
			),
			$overrides
		);
	}

	public function test_custom_field_values_reach_body_as_flat_map(): void {
		$result = Avably_Booking_Validator::validate(
			$this->valid_input( array( 'cf_' . self::CF_TEXT => '  ABC-123  ' ) ),
			'1.0',
			'pl'
		);

		$this->assertTrue( $result['ok'] );
		$this->assertSame( array( self::CF_TEXT => 'ABC-123' ), $result['body']['customFields'] );
	}

	public function test_body_omits_custom_fields_when_form_carried_none(): void {
		$result = Avably_Booking_Validator::validate( $this->valid_input(), '1.0', 'pl' );
		$this->assertTrue( $result['ok'] );
		$this->assertArrayNotHasKey( 'customFields', $result['body'] );
	}

	public function test_prefixed_key_without_identifier_never_leaves_the_form(): void {
		// Zamknięta lista pól body obowiązuje także pola własne: prefiks bez
		// identyfikatora nie pochodzi z naszego formularza.
		$result = Avably_Booking_Validator::validate(
			$this->valid_input( array( 'cf_tenant_id' => 'cokolwiek' ) ),
			'1.0',
			'pl'
		);
		$this->assertTrue( $result['ok'] );
		$this->assertArrayNotHasKey( 'customFields', $result['body'] );
	}

	public function test_oversized_value_is_rejected_at_the_field(): void {
		$result = Avably_Booking_Validator::validate(
			$this->valid_input( array( 'cf_' . self::CF_TEXT => str_repeat( 'x', 2001 ) ) ),
			'1.0',
			'pl'
		);
		$this->assertFalse( $result['ok'] );
		$this->assertSame( 'too_long', $result['errors'][ 'cf_' . self::CF_TEXT ] );
	}

	public function test_non_scalar_value_is_rejected(): void {
		$result = Avably_Booking_Validator::validate(
			$this->valid_input( array( 'cf_' . self::CF_TEXT => array( 'a' => 'b' ) ) ),
			'1.0',
			'pl'
		);
		$this->assertFalse( $result['ok'] );
		$this->assertSame( 'invalid', $result['errors'][ 'cf_' . self::CF_TEXT ] );
	}

	public function test_field_count_ceiling_stops_flood(): void {
		$extra = array();
		for ( $i = 0; $i < Avably_Booking_Validator::CUSTOM_FIELDS_MAX + 5; $i++ ) {
			$extra[ sprintf( 'cf_%08d-1111-4111-8111-111111111111', $i ) ] = 'x';
		}
		$result = Avably_Booking_Validator::validate( $this->valid_input( $extra ), '1.0', 'pl' );
		$this->assertFalse( $result['ok'] );
	}

	// -----------------------------------------------------------------
	// Komunikaty
	// -----------------------------------------------------------------

	public function test_custom_field_message_does_not_leak_raw_key(): void {
		$message = Avably_Booking_Contract::field_message( 'cf_' . self::CF_TEXT, 'required' );
		$this->assertStringNotContainsString( self::CF_TEXT, $message );
		$this->assertStringNotContainsString( 'cf_', $message );
	}

	public function test_custom_field_messages_map_all_contract_types(): void {
		foreach ( Avably_Booking_Contract::FIELD_ERROR_TYPES as $type ) {
			$message = Avably_Booking_Contract::field_message( 'cf_' . self::CF_TEXT, $type );
			$this->assertNotSame( '', $message );
			$this->assertStringNotContainsString( 'cf_', $message );
		}
	}
}
