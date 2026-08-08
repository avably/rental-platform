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
	 * Operator kopiuje bywa adres z karty panelu — historycznie z sufiksem
	 * kontraktu `/api/v1/`. Klient API dokleja tę ścieżkę SAM, więc baza z
	 * sufiksem dawała `/api/v1/api/v1/catalog` → 404 → mylącą diagnozę
	 * „nieprawidłowy klucz”. Sanitizer zdejmuje sufiks (z ukośnikiem i bez),
	 * zachowując resztę ścieżki.
	 */
	public function test_api_url_strips_contract_suffix(): void {
		$cases = [
			'https://sklep.avably.io/api/v1/'              => 'https://sklep.avably.io',
			'https://sklep.avably.io/api/v1'               => 'https://sklep.avably.io',
			'https://sklep.example.com/podkatalog/api/v1/' => 'https://sklep.example.com/podkatalog',
			'https://sklep.avably.io/API/V1/'              => 'https://sklep.avably.io',
			// Wklejone dwa razy (zdarza się przy sklejaniu z instrukcji).
			'https://sklep.avably.io/api/v1/api/v1'        => 'https://sklep.avably.io',
		];
		foreach ( $cases as $input => $expected ) {
			$result = Avably_Booking_Settings::sanitize_input(
				[ 'api_url' => $input ],
				$this->current()
			);
			$this->assertNull( $result['error'], $input );
			$this->assertSame( $expected, $result['settings']['api_url'], $input );
		}
	}

	/** Adres już poprawny przechodzi bez zmian (idempotencja normalizacji). */
	public function test_api_url_without_suffix_is_untouched(): void {
		$cases = [
			'https://sklep.avably.io',
			'https://sklep.example.com/podkatalog',
			// `/api` i `/v1` osobno to NIE sufiks kontraktu — zostają.
			'https://sklep.example.com/api',
			'https://sklep.example.com/v1',
		];
		foreach ( $cases as $url ) {
			$result = Avably_Booking_Settings::sanitize_input(
				[ 'api_url' => $url ],
				$this->current()
			);
			$this->assertNull( $result['error'], $url );
			$this->assertSame( $url, $result['settings']['api_url'], $url );
		}
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

	/**
	 * W4: `http://` wysyła klucz API otwartym tekstem (nagłówek Authorization
	 * bez TLS) i otwiera wstrzyknięcie 302 na ścieżce sieciowej. Produkcja
	 * przyjmuje WYŁĄCZNIE `https://`; komunikat po ludzku, bez nazw zmiennych
	 * ani kluczy ustawień (bramka U1).
	 */
	public function test_http_scheme_is_rejected_in_production(): void {
		$current = $this->current();
		$result  = Avably_Booking_Settings::sanitize_input(
			array( 'api_url' => 'http://sklep.example.com' ),
			$current,
			false
		);
		$this->assertNotNull( $result['error'], 'http:// przeszło' );
		$this->assertSame( $current['api_url'], $result['settings']['api_url'], 'http:// podmieniło zapisany URL' );

		// Bramka U1: żadnych nazw zmiennych/kluczy ustawień w komunikacie.
		foreach ( array( 'api_url', 'api_key', 'key_prefix', 'avably_booking_settings', '$' ) as $forbidden ) {
			$this->assertStringNotContainsString( $forbidden, (string) $result['error'], "komunikat zawiera: {$forbidden}" );
		}
	}

	/** `https://` przechodzi bez zmian (kontrola fałszywego alarmu W4). */
	public function test_https_scheme_is_accepted(): void {
		$result = Avably_Booking_Settings::sanitize_input(
			array( 'api_url' => 'https://sklep.example.com' ),
			$this->current(),
			false
		);
		$this->assertNull( $result['error'] );
		$this->assertSame( 'https://sklep.example.com', $result['settings']['api_url'] );
	}

	/**
	 * Wyjątek dev PRZYPIĘTY: `http://` na host lokalny przechodzi WYŁĄCZNIE w
	 * trybie deweloperskim (ten sam jawny przełącznik, co adresy prywatne).
	 * Bez trybu dev — odrzucone, żeby wyjątek nie stał się furtką produkcyjną.
	 */
	public function test_http_localhost_allowed_only_in_dev_mode(): void {
		$dev = Avably_Booking_Settings::sanitize_input(
			array( 'api_url' => 'http://localhost:3340' ),
			$this->current(),
			true
		);
		$this->assertNull( $dev['error'], 'tryb dev odrzucił http://localhost' );
		$this->assertSame( 'http://localhost:3340', $dev['settings']['api_url'] );

		$prod = Avably_Booking_Settings::sanitize_input(
			array( 'api_url' => 'http://localhost:3340' ),
			$this->current(),
			false
		);
		$this->assertNotNull( $prod['error'], 'produkcja przyjęła http://localhost' );
		$this->assertSame( $this->current()['api_url'], $prod['settings']['api_url'] );
	}

	/**
	 * PRODUKCYJNE rozstrzygnięcie trybu dev PRZYPIĘTE (recenzja PM #216):
	 * `sanitize_settings` woła `sanitize_input` BEZ trzeciego argumentu, więc
	 * wartość bierze się ze stałej `AVABLY_BOOKING_ALLOW_PRIVATE_HOSTS`. Każdy
	 * inny test podaje argument jawnie — mutacja `$allow_private = true;` w
	 * rozstrzygnięciu domyślnym przepuszczała na produkcji `http://` (klucz
	 * otwartym tekstem) i adresy prywatne przy CAŁEJ suicie zielonej. Ten test
	 * odtwarza wywołanie produkcyjne: bez argumentu, przy NIEZDEFINIOWANEJ
	 * stałej.
	 */
	public function test_default_resolution_without_dev_constant_rejects_http_and_private(): void {
		// STRAŻNIK KOLEJNOŚCI: stałej raz zdefiniowanej nie da się odebrać w tym
		// samym procesie PHP. Dowód wymaga czystego stanu — jeśli inny test
		// kiedyś zdefiniuje stałą, ten ma spłonąć GŁOŚNO tutaj, a nie przejść
		// pusto (albo zależeć od kolejności plików w suicie).
		$this->assertFalse(
			defined( 'AVABLY_BOOKING_ALLOW_PRIVATE_HOSTS' ),
			'Suita zdefiniowała stałą trybu dev — dowód produkcyjnego domyślnego rozstrzygnięcia wymaga osobnego procesu'
		);

		$current = $this->current();

		// http:// — na produkcji (bez stałej) odmowa, zapisany URL zostaje.
		$http = Avably_Booking_Settings::sanitize_input(
			array( 'api_url' => 'http://sklep.example.com' ),
			$current
		);
		$this->assertNotNull( $http['error'], 'Domyślne rozstrzygnięcie przepuściło http://' );
		$this->assertSame( $current['api_url'], $http['settings']['api_url'] );

		// Host prywatny (metadane chmury) — to samo.
		$private = Avably_Booking_Settings::sanitize_input(
			array( 'api_url' => 'https://169.254.169.254' ),
			$current
		);
		$this->assertNotNull( $private['error'], 'Domyślne rozstrzygnięcie przepuściło host prywatny' );
		$this->assertSame( $current['api_url'], $private['settings']['api_url'] );

		// Kontrola pozytywna: publiczny https przechodzi także bez argumentu —
		// bez niej test byłby zielony również dla „odrzucaj wszystko".
		$public = Avably_Booking_Settings::sanitize_input(
			array( 'api_url' => 'https://sklep.example.com' ),
			$current
		);
		$this->assertNull( $public['error'] );
		$this->assertSame( 'https://sklep.example.com', $public['settings']['api_url'] );
	}

	/**
	 * Klucz API nie może być autoloadowany (jechać w pamięci z KAŻDYM żądaniem
	 * frontu). register_settings wymusza wyłączenie autoloadu opcji.
	 */
	public function test_settings_option_autoload_is_disabled(): void {
		AvablyTestState::reset();
		Avably_Booking_Settings::register_settings();
		$this->assertArrayHasKey( Avably_Booking_Settings::OPTION_NAME, AvablyTestState::$autoloadCalls );
		$this->assertFalse( AvablyTestState::$autoloadCalls[ Avably_Booking_Settings::OPTION_NAME ] );
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
