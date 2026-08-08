<?php
/**
 * Sanityzacja ustawień: format klucza, walidacja URL-a, semantyka
 * „puste pole = zachowaj zapisany klucz".
 */

use PHPUnit\Framework\TestCase;

final class SettingsTest extends TestCase {

	private const VALID_KEY = 'avbl_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

	private function current(): array {
		return [
			'api_url'    => 'https://www.avably.io',
			'api_key'    => 'avbl_cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
			'key_prefix' => 'avbl_cccccccc',
		];
	}

	public function test_valid_key_is_stored_with_prefix(): void {
		$result = Avably_Booking_Settings::sanitize_input(
			[ 'api_key' => self::VALID_KEY ],
			$this->current()
		);
		$this->assertNull( $result['error'] );
		$this->assertSame( self::VALID_KEY, $result['settings']['api_key'] );
		$this->assertSame( 'avbl_bbbbbbbb', $result['settings']['key_prefix'] );
	}

	public function test_empty_key_keeps_saved_one(): void {
		$result = Avably_Booking_Settings::sanitize_input(
			[ 'api_key' => '' ],
			$this->current()
		);
		$this->assertNull( $result['error'] );
		$this->assertSame( $this->current()['api_key'], $result['settings']['api_key'] );
	}

	public function test_malformed_key_is_rejected_and_saved_one_kept(): void {
		foreach ( [ 'avbl_krotki', 'sk_live_cudzy_format', 'avbl_' . str_repeat( 'g', 64 ) ] as $bad ) {
			$result = Avably_Booking_Settings::sanitize_input(
				[ 'api_key' => $bad ],
				$this->current()
			);
			$this->assertNotNull( $result['error'], $bad );
			$this->assertSame( $this->current()['api_key'], $result['settings']['api_key'], $bad );
		}
	}

	public function test_api_url_validation_and_normalization(): void {
		$ok = Avably_Booking_Settings::sanitize_input(
			[ 'api_url' => 'https://sklep.example.com/' ],
			$this->current()
		);
		$this->assertNull( $ok['error'] );
		$this->assertSame( 'https://sklep.example.com', $ok['settings']['api_url'] );

		$bad = Avably_Booking_Settings::sanitize_input(
			[ 'api_url' => 'ftp://zly.schemat' ],
			$this->current()
		);
		$this->assertNotNull( $bad['error'] );
		$this->assertSame( $this->current()['api_url'], $bad['settings']['api_url'] );

		$empty = Avably_Booking_Settings::sanitize_input(
			[ 'api_url' => '' ],
			$this->current()
		);
		$this->assertSame( Avably_Booking_Settings::DEFAULT_API_URL, $empty['settings']['api_url'] );
	}

	/**
	 * SSRF: pole URL-a zapisuje admin, ale przejęte konto admina nie ma
	 * zamieniać server-side fetcha wtyczki w skaner sieci wewnętrznej ani
	 * czytnik metadanych chmury. Bramka odrzuca hosty prywatne/loopback
	 * i ZACHOWUJE dotychczasowy URL.
	 */
	public function test_private_hosts_are_rejected_outside_dev_mode(): void {
		$attacks = [
			'http://127.0.0.1:8080',
			'http://localhost/api',
			'http://[::1]/api',
			'http://169.254.169.254/latest/meta-data/', // metadane chmury
			'http://10.0.0.5',
			'http://192.168.1.10',
			'http://172.16.4.4',
			'http://host.docker.internal:3340',
			'http://wewnetrzny-serwer',
			'http://baza.internal',
			'http://drukarka.local',
		];
		foreach ( $attacks as $attack ) {
			$result = Avably_Booking_Settings::sanitize_input(
				[ 'api_url' => $attack ],
				$this->current(),
				false
			);
			$this->assertNotNull( $result['error'], "przeszło: {$attack}" );
			$this->assertSame( $this->current()['api_url'], $result['settings']['api_url'], "podmienił URL: {$attack}" );
		}
	}

	/** Tryb dev (stała w wp-config) świadomie dopuszcza adresy prywatne. */
	public function test_private_hosts_allowed_in_dev_mode(): void {
		$result = Avably_Booking_Settings::sanitize_input(
			[ 'api_url' => 'http://host.docker.internal:3340' ],
			$this->current(),
			true
		);
		$this->assertNull( $result['error'] );
		$this->assertSame( 'http://host.docker.internal:3340', $result['settings']['api_url'] );
	}

	/** Adresy publiczne nie mogą wpaść w bramkę anty-SSRF. */
	public function test_public_hosts_pass(): void {
		foreach ( [ 'https://www.avably.io', 'https://sklep.example.com:8443', 'https://203.0.113.10' ] as $url ) {
			$result = Avably_Booking_Settings::sanitize_input(
				[ 'api_url' => $url ],
				$this->current(),
				false
			);
			$this->assertNull( $result['error'], "odrzucony publiczny: {$url}" );
		}
	}

	/** Zapis bez uprawnień administratora nie zmienia niczego. */
	public function test_sanitize_requires_manage_options(): void {
		AvablyTestState::reset();
		AvablyTestState::$canManageOptions = false;

		$before = Avably_Booking_Settings::get();
		$after  = Avably_Booking_Settings::sanitize(
			[
				'api_url' => 'https://napastnik.example',
				'api_key' => 'avbl_' . str_repeat( 'd', 64 ),
			]
		);
		$this->assertSame( $before['api_url'], $after['api_url'] );
		$this->assertSame( $before['api_key'], $after['api_key'] );

		AvablyTestState::$canManageOptions = true;
	}

	/** Strona ustawień nie renderuje się bez manage_options. */
	public function test_settings_page_requires_capability(): void {
		AvablyTestState::reset();
		AvablyTestState::$canManageOptions = false;

		ob_start();
		Avably_Booking_Settings::render_page();
		$html = (string) ob_get_clean();
		$this->assertSame( '', trim( $html ) );

		AvablyTestState::$canManageOptions = true;
		ob_start();
		Avably_Booking_Settings::render_page();
		$html = (string) ob_get_clean();
		$this->assertStringContainsString( 'Avably Booking', $html );
		// Nawet dla admina zapisany klucz NIE wraca do HTML-a w całości.
		$this->assertStringNotContainsString( AVABLY_TEST_API_KEY, $html );
	}

	/** Menu ustawień jest bramkowane capability manage_options. */
	public function test_options_page_registered_with_capability(): void {
		AvablyTestState::reset();
		Avably_Booking_Settings::add_menu();
		$this->assertNotEmpty( AvablyTestState::$optionsPages );
		$this->assertSame( 'manage_options', AvablyTestState::$optionsPages[0]['capability'] );
	}
}
