<?php
/**
 * Renderer: escaping WSZYSTKICH treści z API (§5.4 — dowód XSS, cel mutacji
 * M3), tor płatności offline w formularzu, formatowanie kwot.
 */

use PHPUnit\Framework\TestCase;

final class RendererTest extends TestCase {

	private const PRODUCT = '2a2a2a2a-1111-4222-8333-444444444444';
	private const XSS = '<script>alert("xss")</script>';

	private function catalog( array $product_overrides = [] ): array {
		return [
			'tenant'           => [
				'name'     => 'Wypożyczalnia Testowa',
				'locale'   => 'pl',
				'currency' => 'PLN',
			],
			'products'         => [
				array_merge(
					[
						'id'                    => self::PRODUCT,
						'name'                  => 'Kajak górski',
						'description'           => 'Solidny kajak na rwące rzeki.',
						'base_price_day_grosze' => 12000,
						'deposit_grosze'        => 30000,
					],
					$product_overrides
				),
			],
			'pickup_locations' => [
				[
					'id'             => '3b3b3b3b-1111-4222-8333-555555555555',
					'name'           => 'Magazyn główny',
					'address_street' => 'Prosta 1',
					'address_zip'    => '00-001',
					'address_city'   => 'Warszawa',
				],
			],
			'delivery_methods' => [
				[
					'method'       => 'courier',
					'price_grosze' => 2000,
				],
			],
		];
	}

	/** Dowód XSS (mutacja M3): nazwa produktu ze skryptem NIE wykonuje się. */
	public function test_catalog_escapes_malicious_product_name(): void {
		$html = Avably_Booking_Renderer::render_catalog(
			$this->catalog( [ 'name' => self::XSS, 'description' => '<img src=x onerror=alert(1)>' ] ),
			'https://sklep.example/rezerwacje/'
		);

		$this->assertStringNotContainsString( '<script>', $html );
		$this->assertStringNotContainsString( '<img src=x', $html );
		$this->assertStringContainsString( '&lt;script&gt;', $html );
	}

	public function test_product_view_escapes_all_api_content(): void {
		$catalog = $this->catalog(
			[
				'name'        => self::XSS,
				'description' => '"><script>document.cookie</script>',
			]
		);
		$catalog['pickup_locations'][0]['name'] = '"><script>zloListaOdbioru()</script>';

		$html = Avably_Booking_Renderer::render_product(
			$catalog['products'][0],
			$catalog,
			'https://sklep.example/rezerwacje/'
		);

		$this->assertStringNotContainsString( '<script>', $html );
		$this->assertStringNotContainsString( 'zloListaOdbioru()</script>', $html );
		$this->assertStringContainsString( '&lt;script&gt;', $html );
		// Wstrzyknięcie przez atrybut też nie przechodzi: cudzysłów z danych
		// jest zawsze encją, więc surowa sekwencja payloadu nie występuje.
		$this->assertStringNotContainsString( '"><script', $html );
	}

	/** Formularz iteracji 1 oferuje WYŁĄCZNIE metody offline. */
	public function test_product_form_offers_only_offline_payments(): void {
		$html = Avably_Booking_Renderer::render_product(
			$this->catalog()['products'][0],
			$this->catalog(),
			'/rezerwacje/'
		);

		$this->assertStringContainsString( 'value="transfer"', $html );
		$this->assertStringContainsString( 'value="cod"', $html );
		$this->assertStringNotContainsString( 'value="online"', $html );
	}

	public function test_product_form_lists_configured_delivery_and_pickup(): void {
		$html = Avably_Booking_Renderer::render_product(
			$this->catalog()['products'][0],
			$this->catalog(),
			'/rezerwacje/'
		);

		$this->assertStringContainsString( 'value="courier"', $html );
		// Punkty odbioru istnieją => opcja pickup dostępna mimo braku wpisu
		// w cenniku dostaw.
		$this->assertStringContainsString( 'value="pickup"', $html );
		$this->assertStringContainsString( 'Magazyn główny', $html );
		$this->assertStringContainsString( 'Prosta 1', $html );
	}

	public function test_catalog_skips_products_with_invalid_ids(): void {
		$catalog                  = $this->catalog();
		$catalog['products'][0]['id'] = 'javascript:alert(1)';
		$html                     = Avably_Booking_Renderer::render_catalog( $catalog, '/r/' );

		$this->assertStringNotContainsString( 'javascript:', $html );
	}

	public function test_money_formatting(): void {
		$this->assertSame( '120,00 zł', Avably_Booking_Renderer::format_money( 12000, 'PLN' ) );
		$this->assertSame( '1 234,56 zł', Avably_Booking_Renderer::format_money( 123456, 'PLN' ) );
		$this->assertSame( '19,99 €', Avably_Booking_Renderer::format_money( 1999, 'EUR' ) );
	}

	public function test_render_error_escapes_message(): void {
		$html = Avably_Booking_Renderer::render_error( '<b>surowy html</b>' );
		$this->assertStringNotContainsString( '<b>', $html );
		$this->assertStringContainsString( '&lt;b&gt;', $html );
	}
}
