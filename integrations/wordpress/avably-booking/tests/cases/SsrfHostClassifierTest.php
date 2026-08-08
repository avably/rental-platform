<?php
/**
 * Klasyfikator anty-SSRF — tabela zapisów adresu (recenzja PM #212).
 *
 * ZNALEZISKO PM: `0177.0.0.1` przechodziło. `filter_var(FILTER_VALIDATE_IP)`
 * uznaje ten zapis za śmieć, więc host wpadał do gałęzi „nazwa z kropką" i
 * był klasyfikowany jako publiczny — a `inet_aton` (i cURL) czyta go jako
 * ósemkowe 127.0.0.1. Rozjazd interpretacji filtra i biblioteki sieciowej to
 * cała rodzina bypassów, nie pojedynczy przypadek — dlatego bramka dopuszcza
 * WYŁĄCZNIE kanoniczny dotted-quad, a nie „rozumie" pozostałych zapisów.
 */

use PHPUnit\Framework\TestCase;

final class SsrfHostClassifierTest extends TestCase {

	/** Zapisy, które muszą zostać ZABLOKOWANE. */
	public static function blockedHosts(): array {
		return array(
			// --- sonda PM (14 wejść), część blokowana ---
			'prywatny 10/8'            => array( '10.0.0.5' ),
			'prywatny 172.16/12'       => array( '172.16.0.9' ),
			'loopback'                 => array( '127.0.0.1' ),
			'metadane chmury'          => array( '169.254.169.254' ),
			'IPv6 loopback'            => array( '::1' ),
			'zero'                     => array( '0.0.0.0' ),
			'dziesiętny 32-bit'        => array( '2130706433' ),
			'metadane GCP po nazwie'   => array( 'metadata.google.internal' ),

			// --- ZNALEZISKO: ósemkowy i cała rodzina zapisów ---
			'ósemkowy 0177.0.0.1'      => array( '0177.0.0.1' ),
			'ósemkowy pełny'           => array( '0177.0000.0000.0001' ),
			'ósemkowy 010.0.0.1'       => array( '010.0.0.1' ),
			'szesnastkowy 0x7f.0.0.1'  => array( '0x7f.0.0.1' ),
			'szesnastkowy jedną liczbą' => array( '0x7f000001' ),
			'skrócony 127.1'           => array( '127.1' ),
			'skrócony 10.1'            => array( '10.1' ),
			'wiodące zero w segmencie' => array( '192.168.001.001' ),
			'mieszany ósemkowo-hex'    => array( '0177.0x00.0.01' ),
			'IPv4-mapped w IPv6'       => array( '::ffff:127.0.0.1' ),
			'IPv4-mapped z nawiasami'  => array( '[::ffff:169.254.169.254]' ),

			// --- pozostałe klasy prywatne ---
			'prywatny 192.168/16'      => array( '192.168.1.10' ),
			'link-local IPv6'          => array( 'fe80::1' ),
			'ULA IPv6'                 => array( 'fd00::1' ),
			'localhost'                => array( 'localhost' ),
			'subdomena .localhost'     => array( 'api.localhost' ),
			'nazwa .internal'          => array( 'baza.internal' ),
			'nazwa .local'             => array( 'drukarka.local' ),
			'docker'                   => array( 'host.docker.internal' ),
			'nazwa bez kropki'         => array( 'wewnetrzny-serwer' ),
			'pusty host'               => array( '' ),
		);
	}

	/** Adresy publiczne, które muszą PRZEJŚĆ (kontrola fałszywych alarmów). */
	public static function allowedHosts(): array {
		return array(
			'domena produkcyjna'     => array( 'www.avably.io' ),
			'domena najemcy'         => array( 'sklep.example.com' ),
			'publiczny IPv4'         => array( '203.0.113.10' ),
			'publiczny IPv4 (8.8.8.8)' => array( '8.8.8.8' ),
			// Nazwa z segmentami wyglądającymi „hexowo" to wciąż nazwa —
			// bramka nie ma prawa jej blokować.
			'domena z liter hex'     => array( 'cafe.example' ),
			'domena zaczynająca się cyfrą' => array( '1blu.example.com' ),
		);
	}

	/**
	 * @dataProvider blockedHosts
	 */
	public function test_blocked( string $host ): void {
		$this->assertTrue(
			Avably_Booking_Settings::is_private_host( $host ),
			"host PRZESZEDŁ mimo że powinien być zablokowany: {$host}"
		);
	}

	/**
	 * @dataProvider allowedHosts
	 */
	public function test_allowed( string $host ): void {
		$this->assertFalse(
			Avably_Booking_Settings::is_private_host( $host ),
			"host zablokowany mimo że jest publiczny: {$host}"
		);
	}

	/** Bramka działa też na pełnym URL-u z ustawień (integracja z sanitizerem). */
	public function test_sanitizer_rejects_octal_url(): void {
		$current = array(
			'api_url'    => 'https://www.avably.io',
			'api_key'    => '',
			'key_prefix' => '',
		);
		foreach ( array( 'http://0177.0.0.1:54321/api/v1', 'http://0x7f.0.0.1', 'http://2130706433', 'http://127.1' ) as $url ) {
			$result = Avably_Booking_Settings::sanitize_input( array( 'api_url' => $url ), $current, false );
			$this->assertNotNull( $result['error'], "sanitizer przepuścił: {$url}" );
			$this->assertSame( 'https://www.avably.io', $result['settings']['api_url'], "sanitizer podmienił URL na: {$url}" );
		}
	}

	/** Rozpoznanie „zapisu liczbowego" nie może łapać zwykłych domen. */
	public function test_numeric_host_detection(): void {
		foreach ( array( '127.0.0.1', '0177.0.0.1', '0x7f.0.0.1', '2130706433', '127.1' ) as $numeric ) {
			$this->assertTrue( Avably_Booking_Settings::looks_numeric_host( $numeric ), $numeric );
		}
		foreach ( array( 'www.avably.io', 'cafe.example', '1blu.example.com', 'a.b.c' ) as $name ) {
			$this->assertFalse( Avably_Booking_Settings::looks_numeric_host( $name ), $name );
		}
	}

	/** Kanoniczny dotted-quad: bez wiodących zer, cztery segmenty, ≤255. */
	public function test_canonical_ipv4(): void {
		foreach ( array( '127.0.0.1', '8.8.8.8', '0.0.0.0', '255.255.255.255' ) as $ok ) {
			$this->assertTrue( Avably_Booking_Settings::is_canonical_ipv4( $ok ), $ok );
		}
		foreach ( array( '0177.0.0.1', '192.168.001.001', '127.1', '1.2.3.4.5', '256.1.1.1', '0x7f.0.0.1' ) as $bad ) {
			$this->assertFalse( Avably_Booking_Settings::is_canonical_ipv4( $bad ), $bad );
		}
	}
}
