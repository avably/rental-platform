<?php
/**
 * BRAMKA NONCE (CSRF) — przypięta dla KAŻDEJ z trzech akcji ajaxowych.
 *
 * Powód istnienia pliku (recenzja PM #212): sonda na żywej instalacji
 * pokazała 403 bez nonce'a JEDNORAZOWO, ale regres bramki przechodził całą
 * suitę — usunięcie `check_ajax_referer` z `guard()` nie paliło niczego.
 * To klasyczny CSRF WordPressa, więc bramka dostaje własny dowód.
 *
 * MIARĄ JEST LICZNIK WYWOŁAŃ KLIENTA API, nie kod odpowiedzi: żądanie bez
 * poprawnego nonce'a ma się zatrzymać ZANIM wtyczka dotknie API najemcy
 * (inaczej napastnik i tak paliłby budżet limitów i składał rezerwacje).
 */

use PHPUnit\Framework\TestCase;

final class AjaxNonceGateTest extends TestCase {

	private const PRODUCT = '2a2a2a2a-1111-4222-8333-444444444444';

	private AvablySpyApiClient $spy;

	protected function setUp(): void {
		AvablyTestState::reset();
		$this->spy = new AvablySpyApiClient(
			array(
				'ok'         => true,
				'data'       => array(
					'available_units' => 2,
					'total_units'     => 2,
					'order'           => array( 'orderNumber' => 'AV-2026-999' ),
				),
				'error_code' => null,
			)
		);
		AvablyTestState::$apiClient = $this->spy;
	}

	/** Poprawne parametry każdej akcji — nonce doklejają testy osobno. */
	private function seedRequest( string $action ): void {
		$_SERVER['REQUEST_METHOD'] = 'reserve' === $action ? 'POST' : 'GET';
		$params                    = array();
		if ( 'availability' === $action ) {
			$params = array(
				'product_id' => self::PRODUCT,
				'start_date' => '2026-09-01',
				'end_date'   => '2026-09-03',
			);
		} elseif ( 'month' === $action ) {
			$params = array(
				'product_id' => self::PRODUCT,
				'month'      => date( 'Y-m' ),
			);
		} else {
			$params = array(
				'product_id'      => self::PRODUCT,
				'quantity'        => '1',
				'start_date'      => '2026-09-01',
				'end_date'        => '2026-09-03',
				'full_name'       => 'Jan Kowalski',
				'email'           => 'jan@example.com',
				'delivery_method' => 'courier',
				'payment_method'  => 'transfer',
				'terms_accepted'  => '1',
			);
		}
		if ( 'reserve' === $action ) {
			$_POST = $params;
		} else {
			$_GET = $params;
		}
		$_REQUEST = $params;
	}

	private function call( string $action ): void {
		$map = array(
			'availability' => array( Avably_Booking_Ajax::class, 'handle_availability' ),
			'month'        => array( Avably_Booking_Ajax::class, 'handle_month' ),
			'reserve'      => array( Avably_Booking_Ajax::class, 'handle_reserve' ),
		);
		call_user_func( $map[ $action ] );
	}

	public static function actions(): array {
		return array(
			'availability' => array( 'availability' ),
			'month'        => array( 'month' ),
			'reserve'      => array( 'reserve' ),
		);
	}

	/**
	 * BRAK nonce'a → żądanie zatrzymane, ZERO wywołań klienta API.
	 *
	 * @dataProvider actions
	 */
	public function test_missing_nonce_stops_request_before_api( string $action ): void {
		$this->seedRequest( $action );
		// nonce celowo NIE dołożony

		try {
			$this->call( $action );
			$this->fail( "Akcja {$action} nie zatrzymała żądania bez nonce'a" );
		} catch ( AvablyTestHalt $halt ) {
			$this->assertSame( 0, $this->spy->calls, "Akcja {$action} dotknęła API mimo braku nonce'a" );
		} catch ( AvablyTestJsonResponse $response ) {
			// Odmowa JSON-em też jest akceptowalna — pod warunkiem, że API
			// nie zostało dotknięte i odpowiedź NIE jest sukcesem.
			$this->assertFalse( $response->success, "Akcja {$action} odpowiedziała sukcesem bez nonce'a" );
			$this->assertSame( 0, $this->spy->calls, "Akcja {$action} dotknęła API mimo braku nonce'a" );
		}
	}

	/**
	 * ZŁY nonce (np. z cudzej sesji / stary) → to samo.
	 *
	 * @dataProvider actions
	 */
	public function test_invalid_nonce_stops_request_before_api( string $action ): void {
		$this->seedRequest( $action );
		$_REQUEST['nonce'] = 'nonce-napastnika';
		$_GET['nonce']     = 'nonce-napastnika';
		$_POST['nonce']    = 'nonce-napastnika';

		try {
			$this->call( $action );
			$this->fail( "Akcja {$action} nie zatrzymała żądania ze złym nonce'em" );
		} catch ( AvablyTestHalt $halt ) {
			$this->assertSame( 0, $this->spy->calls, "Akcja {$action} dotknęła API mimo złego nonce'a" );
		} catch ( AvablyTestJsonResponse $response ) {
			$this->assertFalse( $response->success );
			$this->assertSame( 0, $this->spy->calls, "Akcja {$action} dotknęła API mimo złego nonce'a" );
		}
	}

	/**
	 * KONTROLA POZYTYWNA: z poprawnym nonce'em akcja DZIAŁA i woła API.
	 * Bez niej testy wyżej przechodziłyby także dla akcji zepsutej na amen.
	 *
	 * @dataProvider actions
	 */
	public function test_valid_nonce_reaches_api( string $action ): void {
		$this->seedRequest( $action );
		$_REQUEST['nonce'] = AvablyTestState::$validNonce;
		$_GET['nonce']     = AvablyTestState::$validNonce;
		$_POST['nonce']    = AvablyTestState::$validNonce;

		try {
			$this->call( $action );
			$this->fail( "Akcja {$action} nie zakończyła żądania odpowiedzią JSON" );
		} catch ( AvablyTestJsonResponse $response ) {
			$this->assertTrue( $response->success, "Akcja {$action} odmówiła mimo poprawnego nonce'a" );
			$this->assertGreaterThan( 0, $this->spy->calls, "Akcja {$action} nie zawołała API" );
		}
	}

	/**
	 * Odpowiedzi ajaxowe nie mogą być cache'owane (świeży nonce, dynamiczny
	 * stan dostępności) — `nocache_headers()` na KAŻDEJ ścieżce.
	 *
	 * @dataProvider actions
	 */
	public function test_responses_are_marked_no_cache( string $action ): void {
		$this->seedRequest( $action );
		$_REQUEST['nonce'] = AvablyTestState::$validNonce;
		$_GET['nonce']     = AvablyTestState::$validNonce;
		$_POST['nonce']    = AvablyTestState::$validNonce;

		try {
			$this->call( $action );
		} catch ( AvablyTestJsonResponse $response ) {
			// oczekiwane zakończenie
		}
		$this->assertGreaterThan( 0, AvablyTestState::$nocacheCalls, "Akcja {$action} nie ustawiła nagłówków no-cache" );
	}

	/** Rezerwacja przez GET nie przechodzi (mutacja stanu tylko POST-em). */
	public function test_reserve_rejects_get(): void {
		$this->seedRequest( 'reserve' );
		$_SERVER['REQUEST_METHOD'] = 'GET';
		$_REQUEST['nonce']         = AvablyTestState::$validNonce;
		$_POST['nonce']            = AvablyTestState::$validNonce;

		try {
			Avably_Booking_Ajax::handle_reserve();
			$this->fail( 'Rezerwacja przeszła metodą GET' );
		} catch ( AvablyTestJsonResponse $response ) {
			$this->assertFalse( $response->success );
			$this->assertSame( 0, $this->spy->calls );
		}
	}

	/** Dławienie rezerwacji per odwiedzający odcina PRZED wywołaniem API. */
	public function test_reservation_rate_limit_stops_before_api(): void {
		for ( $i = 1; $i <= Avably_Booking_Ajax::RESERVE_RATE_LIMIT; $i++ ) {
			$this->seedRequest( 'reserve' );
			$_REQUEST['nonce'] = AvablyTestState::$validNonce;
			$_POST['nonce']    = AvablyTestState::$validNonce;
			try {
				Avably_Booking_Ajax::handle_reserve();
			} catch ( AvablyTestJsonResponse $response ) {
				$this->assertTrue( $response->success, "Próba {$i} odmówiona przed limitem" );
			}
		}
		$this->assertSame( Avably_Booking_Ajax::RESERVE_RATE_LIMIT, $this->spy->calls );

		// Próba ponad limit: odmowa i ZERO nowych wywołań API.
		$this->seedRequest( 'reserve' );
		$_REQUEST['nonce'] = AvablyTestState::$validNonce;
		$_POST['nonce']    = AvablyTestState::$validNonce;
		try {
			Avably_Booking_Ajax::handle_reserve();
			$this->fail( 'Limit nie zadziałał' );
		} catch ( AvablyTestJsonResponse $response ) {
			$this->assertFalse( $response->success );
			$this->assertSame( 429, $response->status );
			$this->assertSame( Avably_Booking_Ajax::RESERVE_RATE_LIMIT, $this->spy->calls );
		}
	}

	/** Okno stałe: po jego upływie licznik startuje od zera. */
	public function test_rate_window_resets(): void {
		$now   = 1_800_000_000;
		$state = null;
		for ( $i = 0; $i < 10; $i++ ) {
			$decision = Avably_Booking_Ajax::next_rate_state( $state, $now, 3600, 10 );
			$state    = $decision['state'];
			$this->assertTrue( $decision['allowed'] );
		}
		$this->assertFalse( Avably_Booking_Ajax::next_rate_state( $state, $now, 3600, 10 )['allowed'] );
		$this->assertTrue( Avably_Booking_Ajax::next_rate_state( $state, $now + 3600, 3600, 10 )['allowed'] );
	}

	/** Kubełek limitu bierze REMOTE_ADDR, nie podrabialny nagłówek klienta. */
	public function test_rate_bucket_ignores_forwarded_header(): void {
		$a = Avably_Booking_Ajax::visitor_bucket(
			array(
				'REMOTE_ADDR'          => '203.0.113.9',
				'HTTP_X_FORWARDED_FOR' => '1.1.1.1',
			)
		);
		$b = Avably_Booking_Ajax::visitor_bucket(
			array(
				'REMOTE_ADDR'          => '203.0.113.9',
				'HTTP_X_FORWARDED_FOR' => '2.2.2.2',
			)
		);
		$c = Avably_Booking_Ajax::visitor_bucket( array( 'REMOTE_ADDR' => '198.51.100.4' ) );
		$this->assertSame( $a, $b, 'Nagłówek klienta zmienił kubełek limitu' );
		$this->assertNotSame( $a, $c );
	}
}
