<?php
/**
 * Warstwa ajaxowa — parsery parametrów (ścisły whitelist) i whitelisty
 * odpowiedzi. Endpoint NIE jest otwartym proxy (§5.2): przyjmuje tylko
 * zdefiniowane parametry, a odpowiedź buduje z zamkniętych list pól.
 */

use PHPUnit\Framework\TestCase;

final class AjaxGuardTest extends TestCase {

	private const PRODUCT = '2A2A2A2A-1111-4222-8333-444444444444';

	public function test_availability_params_happy_path_returns_only_three_keys(): void {
		$parsed = Avably_Booking_Ajax::parse_availability_params(
			[
				'product_id' => self::PRODUCT,
				'start_date' => '2026-09-01',
				'end_date'   => '2026-09-03',
				// Próby przemytu — muszą zginąć:
				'path'       => '/api/v1/anything',
				'url'        => 'https://evil.example',
				'endpoint'   => 'reservations',
				'tenant_id'  => 'cudzy',
			]
		);
		$this->assertNotNull( $parsed );
		$this->assertSame(
			[ 'product_id', 'start_date', 'end_date' ],
			array_keys( $parsed ),
			'Parser przepuścił parametry spoza whitelisty'
		);
		$this->assertSame( strtolower( self::PRODUCT ), $parsed['product_id'] );
	}

	public function test_availability_params_reject_garbage(): void {
		$bad = [
			[ 'product_id' => '../admin', 'start_date' => '2026-09-01', 'end_date' => '2026-09-02' ],
			[ 'product_id' => self::PRODUCT, 'start_date' => '01-09-2026', 'end_date' => '2026-09-02' ],
			[ 'product_id' => self::PRODUCT, 'start_date' => '2026-09-05', 'end_date' => '2026-09-01' ],
			[ 'product_id' => self::PRODUCT, 'start_date' => '2026-02-31', 'end_date' => '2026-03-01' ],
			[ 'start_date' => '2026-09-01', 'end_date' => '2026-09-02' ],
			[ 'product_id' => [ self::PRODUCT ], 'start_date' => '2026-09-01', 'end_date' => '2026-09-02' ],
		];
		foreach ( $bad as $i => $params ) {
			$this->assertNull( Avably_Booking_Ajax::parse_availability_params( $params ), "przypadek {$i}" );
		}
	}

	public function test_month_params_enforce_horizon(): void {
		$today = '2026-08-08';
		$this->assertNotNull( Avably_Booking_Ajax::parse_month_params( [ 'product_id' => self::PRODUCT, 'month' => '2026-08' ], $today ) );
		$this->assertNotNull( Avably_Booking_Ajax::parse_month_params( [ 'product_id' => self::PRODUCT, 'month' => '2027-08' ], $today ) );
		// Przeszłość i za horyzontem — odmowa.
		$this->assertNull( Avably_Booking_Ajax::parse_month_params( [ 'product_id' => self::PRODUCT, 'month' => '2026-07' ], $today ) );
		$this->assertNull( Avably_Booking_Ajax::parse_month_params( [ 'product_id' => self::PRODUCT, 'month' => '2027-09' ], $today ) );
		// Format.
		$this->assertNull( Avably_Booking_Ajax::parse_month_params( [ 'product_id' => self::PRODUCT, 'month' => '2026-13' ], $today ) );
		$this->assertNull( Avably_Booking_Ajax::parse_month_params( [ 'product_id' => self::PRODUCT, 'month' => 'sierpien' ], $today ) );
		$this->assertNull( Avably_Booking_Ajax::parse_month_params( [ 'product_id' => 'zly', 'month' => '2026-08' ], $today ) );
	}

	public function test_month_days_skip_past_in_current_month(): void {
		$days = Avably_Booking_Ajax::month_days( '2026-08', '2026-08-08' );
		$this->assertSame( '2026-08-08', $days[0] );
		$this->assertSame( '2026-08-31', end( $days ) );
		$this->assertCount( 24, $days );

		$future = Avably_Booking_Ajax::month_days( '2026-09', '2026-08-08' );
		$this->assertCount( 30, $future );
		$this->assertSame( '2026-09-01', $future[0] );
	}

	public function test_pick_availability_strips_everything_but_counts(): void {
		$picked = Avably_Booking_Ajax::pick_availability(
			[
				'available_units' => '3',
				'total_units'     => 5,
				'secret'          => 'avbl_nie_powinno_wyjsc',
				'debug'           => [ 'sql' => 'select 1' ],
			]
		);
		$this->assertSame( [ 'available_units' => 3, 'total_units' => 5 ], $picked );
	}

	/**
	 * Whitelist odpowiedzi rezerwacji: zamknięta lista pól podsumowania —
	 * nic spoza niej (uchwyty, diagnostyka, klucze) nie wychodzi do
	 * przeglądarki.
	 */
	public function test_pick_order_summary_is_closed_list(): void {
		$api_response = [
			'status'   => 'success',
			'nextStep' => 'confirmation',
			'order'    => [
				'orderNumber'        => 'ZAM-2026-0001',
				'orderStatus'        => 'pending',
				'paymentStatus'      => 'unpaid',
				'paymentMethod'      => 'transfer',
				'startDate'          => '2026-09-01',
				'endDate'            => '2026-09-03',
				'deliveryMethod'     => 'courier',
				'totalRentalGrosze'  => 30000,
				'totalDepositGrosze' => 10000,
				'deliveryGrosze'     => 2000,
				'currency'           => 'PLN',
				'items'              => [ [ 'productId' => 'x' ] ],
				// Pola, których NIE wolno przepuścić (symulacja rozszerzenia):
				'logToken'           => 'sekretny-uchwyt',
				'apiKey'             => 'avbl_wyciek',
			],
			'debug'    => 'stacktrace',
		];
		$picked = Avably_Booking_Ajax::pick_order_summary( $api_response );

		$this->assertSame(
			[
				'order_number',
				'start_date',
				'end_date',
				'payment_method',
				'delivery_method',
				'total_rental_grosze',
				'total_deposit_grosze',
				'delivery_grosze',
				'currency',
			],
			array_keys( $picked )
		);
		$serialized = json_encode( $picked );
		$this->assertStringNotContainsString( 'avbl_', $serialized );
		$this->assertStringNotContainsString( 'logToken', $serialized );
		$this->assertStringNotContainsString( 'uchwyt', $serialized );
		$this->assertSame( 'ZAM-2026-0001', $picked['order_number'] );
		$this->assertSame( 30000, $picked['total_rental_grosze'] );
	}
}
