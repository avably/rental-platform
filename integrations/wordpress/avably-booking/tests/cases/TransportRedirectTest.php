<?php
/**
 * W1 (SSRF przez przekierowanie) — dowód BEHAWIORALNY na modelu transportu.
 *
 * Luka: `wp_remote_request()` domyślnie podąża za pięcioma przekierowaniami,
 * przenosząc nagłówek `Authorization: Bearer avbl_…` na host wskazany w
 * `Location` — także prywatny. Bramka anty-SSRF na ustawieniach sprawdza tylko
 * host wpisany w konfiguracji; celu przekierowania nie widzi.
 *
 * Naprawa: transport idzie przez `wp_safe_remote_request()` (reject_unsafe_urls
 * — WordPress waliduje adres per żądanie, także po resolucji DNS) ORAZ z
 * `redirection => 0` (żadnego podążania). Kod 3xx to błąd konfiguracji, nie
 * stan aplikacyjny — nie wolno go oddać jako surowe „302".
 *
 * Model `AvablyHttpModel` (bootstrap) odwzorowuje jedyną własność, która
 * decyduje o luce: podążanie za `redirection` przekierowaniami przenosi
 * nagłówki na host docelowy. Cofnięcie `redirection => 0` (domyślne 5) albo
 * powrót do `wp_remote_request` sprawia, że klucz wychodzi na host prywatny —
 * i pali te testy.
 */

use PHPUnit\Framework\TestCase;

final class TransportRedirectTest extends TestCase {

	private const KEY  = AVABLY_TEST_API_KEY;
	private const BASE = 'https://api.example.test';

	protected function setUp(): void {
		AvablyHttpModel::reset();
	}

	/** Host każdego zarejestrowanego żądania. */
	private static function hostOf( string $url ): string {
		$host = parse_url( $url, PHP_URL_HOST );
		return is_string( $host ) ? $host : '';
	}

	/**
	 * Transport dostaje 302 → host prywatny: dokładnie JEDNO żądanie, a
	 * nagłówek Authorization nie opuszcza pierwotnego hosta.
	 */
	public function test_transport_does_not_follow_redirect_to_private_host(): void {
		AvablyHttpModel::$redirectFrom = self::BASE . '/api/v1/catalog';
		AvablyHttpModel::$redirectTo   = 'http://169.254.169.254/latest/meta-data/';

		$result = Avably_Booking_Plugin::http_transport(
			array(
				'method'  => 'GET',
				'url'     => self::BASE . '/api/v1/catalog',
				'timeout' => 15,
				'headers' => array(
					'Authorization' => 'Bearer ' . self::KEY,
					'Accept'        => 'application/json',
				),
			)
		);

		// Brak podążania za 302 → jedno żądanie.
		$this->assertCount( 1, AvablyHttpModel::$calls );

		// Authorization NIE dotarł na żaden host inny niż skonfigurowany.
		foreach ( AvablyHttpModel::$calls as $call ) {
			if ( 'api.example.test' !== self::hostOf( $call['url'] ) ) {
				$this->assertArrayNotHasKey(
					'Authorization',
					$call['headers'],
					'Authorization wyszedł na host: ' . $call['url']
				);
			}
		}

		// 3xx nie wycieka jako surowy „302" — transport zgłasza błąd.
		$this->assertArrayHasKey( 'transport_error', $result );
		$this->assertArrayNotHasKey( 'code', $result );
	}

	/**
	 * Transport użył wariantu walidującego adres (reject_unsafe_urls) i wyłączył
	 * podążanie za przekierowaniami — to widać wprost w argumentach żądania.
	 */
	public function test_transport_uses_safe_variant_with_redirection_zero(): void {
		AvablyHttpModel::$redirectFrom = self::BASE . '/api/v1/catalog';
		AvablyHttpModel::$redirectTo   = 'http://127.0.0.1:9000/internal';

		Avably_Booking_Plugin::http_transport(
			array(
				'method'  => 'GET',
				'url'     => self::BASE . '/api/v1/catalog',
				'timeout' => 15,
				'headers' => array( 'Authorization' => 'Bearer ' . self::KEY ),
			)
		);

		$this->assertNotEmpty( AvablyHttpModel::$calls );
		$this->assertTrue( AvablyHttpModel::$calls[0]['safe'], 'transport nie użył wariantu wp_safe_remote_request' );
		$this->assertSame( 0, AvablyHttpModel::$calls[0]['redirection'], 'transport nie ustawił redirection => 0' );
	}

	/**
	 * Ścieżka pełnego klienta produkcyjnego (jak w Avably_Booking_Plugin::
	 * api_client): API oddające 302 na host prywatny NIE może skutkować
	 * żądaniem do tego hosta ani sukcesem — klient widzi błąd serwera, a klucz
	 * zostaje po stronie pierwotnego hosta.
	 */
	public function test_full_client_never_reaches_private_host(): void {
		AvablyHttpModel::$redirectFrom = self::BASE . '/api/v1/catalog';
		AvablyHttpModel::$redirectTo   = 'http://127.0.0.1:9000/internal';

		$client = new Avably_Booking_Api_Client(
			self::BASE,
			self::KEY,
			array( 'Avably_Booking_Plugin', 'http_transport' )
		);
		$result = $client->get_catalog();

		$this->assertFalse( $result['ok'] );
		$this->assertSame( 'server_error', $result['error_code'] );
		$this->assertCount( 1, AvablyHttpModel::$calls );
		foreach ( AvablyHttpModel::$calls as $call ) {
			$this->assertStringStartsWith( self::BASE, $call['url'], 'żądanie wyszło poza skonfigurowany host' );
		}
	}

	/** Zwykła odpowiedź 200 nadal przechodzi (kontrola fałszywego alarmu). */
	public function test_plain_success_still_passes_through(): void {
		$result = Avably_Booking_Plugin::http_transport(
			array(
				'method'  => 'GET',
				'url'     => self::BASE . '/api/v1/catalog',
				'timeout' => 15,
				'headers' => array( 'Authorization' => 'Bearer ' . self::KEY ),
			)
		);
		$this->assertSame( 200, $result['code'] );
		$this->assertSame( '{"products":[]}', $result['body'] );
	}

	/** Awaria transportu (WP_Error) nadal mapuje się na błąd, bez szczegółów. */
	public function test_transport_error_is_reported(): void {
		AvablyHttpModel::$forceError = 'http_request_failed';
		$result = Avably_Booking_Plugin::http_transport(
			array(
				'method'  => 'GET',
				'url'     => self::BASE . '/api/v1/catalog',
				'timeout' => 15,
				'headers' => array( 'Authorization' => 'Bearer ' . self::KEY ),
			)
		);
		$this->assertArrayHasKey( 'transport_error', $result );
		$this->assertSame( 'http_request_failed', $result['transport_error'] );
	}
}
