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
			[ 'api_url' => 'http://host.docker.internal:3300/' ],
			$this->current()
		);
		$this->assertNull( $ok['error'] );
		$this->assertSame( 'http://host.docker.internal:3300', $ok['settings']['api_url'] );

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
}
