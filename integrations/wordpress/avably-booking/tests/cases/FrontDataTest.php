<?php
/**
 * GRANICA SEKRETU (§5.1, dowód mutacyjny M1): payload frontowy —
 * jedyne dane wtyczki dla przeglądarki — NIE ZAWIERA klucza API,
 * jego prefiksu ani URL-a API.
 *
 * Bootstrap testów symuluje INSTALACJĘ Z ZAPISANYM KLUCZEM
 * (get_option zwraca avbl_…) — gdyby payload sięgał do ustawień po
 * sekret, ten test by go zobaczył.
 */

use PHPUnit\Framework\TestCase;

final class FrontDataTest extends TestCase {

	public function test_front_payload_never_contains_api_key(): void {
		$data       = Avably_Booking_Plugin::front_script_data(
			'https://sklep.example/wp-admin/admin-ajax.php',
			'nonce-123'
		);
		$serialized = json_encode( $data, JSON_UNESCAPED_SLASHES );

		// Sekret (i cokolwiek w jego formacie) nie występuje.
		$this->assertStringNotContainsString( 'avbl_', $serialized );
		$this->assertStringNotContainsString( AVABLY_TEST_API_KEY, $serialized );
		// URL API platformy też zostaje po stronie serwera — przeglądarka
		// zna wyłącznie admin-ajax.php instalacji.
		$this->assertStringNotContainsString( 'api.example.test', $serialized );
		$this->assertStringNotContainsString( 'api_key', $serialized );
		$this->assertStringNotContainsString( 'apiKey', $serialized );
	}

	public function test_front_payload_shape_is_closed(): void {
		$data = Avably_Booking_Plugin::front_script_data( '/wp-admin/admin-ajax.php', 'n' );
		$this->assertSame( [ 'ajaxUrl', 'nonce', 'i18n' ], array_keys( $data ) );
		$this->assertSame( '/wp-admin/admin-ajax.php', $data['ajaxUrl'] );
		$this->assertSame( 'n', $data['nonce'] );
		$this->assertIsArray( $data['i18n'] );
	}
}
