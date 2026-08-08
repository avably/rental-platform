<?php
/**
 * Bramki KONTRAKTU ŹRÓDŁA — wektory, których test behawioralny nie złapie,
 * bo dotyczą kształtu kodu, nie jego wyniku (precedens: kontrakt źródła
 * funkcji w packages/db).
 *
 * Każda z tych asercji pilnuje klasycznego wektora ataku na wtyczki WP.
 */

use PHPUnit\Framework\TestCase;

final class SourceHardeningTest extends TestCase {

	private static function pluginDir(): string {
		return dirname( __DIR__, 2 );
	}

	/**
	 * Kod bez komentarzy — skany wektorów mają badać KOD, nie własną prozę
	 * (nagłówki modułów wymieniają nazwy sinków, żeby powiedzieć, czego NIE
	 * używamy; skan po surowym pliku łapałby te wzmianki).
	 */
	private static function stripComments( string $code ): string {
		$code = preg_replace( '#/\*.*?\*/#s', '', $code );
		return (string) preg_replace( '#(^|\s)//[^\n]*#', '$1', (string) $code );
	}

	/** @return array<string,string> ścieżka => treść */
	private static function phpSources(): array {
		$dir   = self::pluginDir();
		$files = array_merge(
			glob( $dir . '/includes/*.php' ) ?: array(),
			glob( $dir . '/blocks/booking/*.php' ) ?: array(),
			array( $dir . '/avably-booking.php', $dir . '/uninstall.php' )
		);
		$out = array();
		foreach ( $files as $file ) {
			if ( is_file( $file ) ) {
				$out[ basename( $file ) ] = (string) file_get_contents( $file );
			}
		}
		return $out;
	}

	/** Żadnego wykonywania kodu ani deserializacji danych z API/żądania. */
	public function test_no_dangerous_sinks_in_php(): void {
		$forbidden = array( 'eval(', 'create_function', 'unserialize(', 'maybe_unserialize(', 'extract(', 'assert(', 'passthru(', 'shell_exec(', 'proc_open(', 'popen(' );
		foreach ( self::phpSources() as $name => $raw ) {
			$code = self::stripComments( $raw );
			foreach ( $forbidden as $needle ) {
				$this->assertStringNotContainsString( $needle, $code, "{$name} używa {$needle}" );
			}
		}
	}

	/** Dane z API nigdy nie idą do bazy WP zapytaniem SQL wtyczki. */
	public function test_plugin_does_not_touch_the_database_directly(): void {
		foreach ( self::phpSources() as $name => $raw ) {
			$this->assertStringNotContainsString( '$wpdb', self::stripComments( $raw ), "{$name} sięga do \$wpdb" );
		}
	}

	/**
	 * KAŻDY handler ajaxowy przechodzi przez wspólną bramkę `self::guard()`,
	 * a guard woła `check_ajax_referer` i `nocache_headers`.
	 */
	public function test_every_ajax_handler_goes_through_guard(): void {
		$code = self::phpSources()['class-avably-booking-ajax.php'];
		foreach ( array( 'handle_availability', 'handle_month', 'handle_reserve' ) as $handler ) {
			$this->assertMatchesRegularExpression(
				'/function\s+' . $handler . '\(\s*\)\s*:\s*void\s*\{\s*self::guard\(\);/',
				$code,
				"{$handler} nie zaczyna się od self::guard()"
			);
		}
		$this->assertStringContainsString( 'check_ajax_referer( self::NONCE_ACTION', $code );
		$this->assertStringContainsString( 'nocache_headers();', $code );
	}

	/** Handlery ajaxowe są zarejestrowane też dla niezalogowanych (nopriv). */
	public function test_ajax_actions_registered_for_visitors(): void {
		$code = self::phpSources()['class-avably-booking-ajax.php'];
		foreach ( array( 'availability', 'month', 'reserve' ) as $action ) {
			$this->assertStringContainsString( "wp_ajax_avably_booking_{$action}", $code );
			$this->assertStringContainsString( "wp_ajax_nopriv_avably_booking_{$action}", $code );
		}
	}

	/** uninstall.php: guard WP_UNINSTALL_PLUGIN + faktyczne usunięcie klucza. */
	public function test_uninstall_is_guarded_and_removes_the_key(): void {
		$code = self::phpSources()['uninstall.php'];
		$this->assertStringContainsString( "defined( 'WP_UNINSTALL_PLUGIN' )", $code );
		$this->assertMatchesRegularExpression( '/if\s*\(\s*!\s*defined\(\s*\'WP_UNINSTALL_PLUGIN\'\s*\)\s*\)\s*\{\s*exit;/', $code );
		$this->assertStringContainsString( "delete_option( 'avably_booking_settings' )", $code );
		$this->assertSame(
			Avably_Booking_Settings::OPTION_NAME,
			'avably_booking_settings',
			'Nazwa opcji rozjechała się z uninstall.php'
		);
	}

	/** Każdy plik PHP odmawia bezpośredniego wywołania (bez ABSPATH). */
	public function test_direct_access_is_blocked(): void {
		foreach ( self::phpSources() as $name => $code ) {
			if ( 'uninstall.php' === $name ) {
				continue; // ma własny guard (WP_UNINSTALL_PLUGIN)
			}
			$this->assertStringContainsString( "defined( 'ABSPATH' )", $code, "{$name} bez bramki ABSPATH" );
		}
	}

	/**
	 * JS: dane z API trafiają do DOM WYŁĄCZNIE przez textContent — żadnego
	 * innerHTML/outerHTML/insertAdjacentHTML/document.write ani eval.
	 */
	public function test_frontend_js_has_no_html_sinks(): void {
		$raw  = (string) file_get_contents( self::pluginDir() . '/assets/booking.js' );
		$code = self::stripComments( $raw );
		foreach ( array( 'innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function' ) as $sink ) {
			$this->assertStringNotContainsString( $sink, $code, "booking.js używa {$sink}" );
		}
		$this->assertGreaterThan( 0, substr_count( $code, 'textContent' ) );
	}

	/** Skrypt frontowy nie zna adresu API ani klucza — tylko admin-ajax. */
	public function test_frontend_js_never_references_the_key(): void {
		$js = (string) file_get_contents( self::pluginDir() . '/assets/booking.js' );
		foreach ( array( 'avbl_', 'apiKey', 'api_key', 'Authorization', 'Bearer' ) as $needle ) {
			$this->assertStringNotContainsString( $needle, $js, "booking.js zawiera {$needle}" );
		}
	}

	/** Nagłówek wtyczki deklaruje minima środowiska (ADR-110). */
	public function test_plugin_header_declares_minimums(): void {
		$code = self::phpSources()['avably-booking.php'];
		$this->assertStringContainsString( 'Requires PHP:      8.1', $code );
		$this->assertStringContainsString( 'Requires at least: 6.5', $code );
	}
}
