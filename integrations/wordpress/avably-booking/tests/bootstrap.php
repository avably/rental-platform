<?php
/**
 * Bootstrap testów jednostkowych wtyczki — BEZ WordPressa.
 *
 * Testujemy czystą logikę (klient API, kontrakt, walidator, renderer,
 * parsery ajaxowe, sanityzacja ustawień) ORAZ handlery ajaxowe end-to-end
 * na shimach WP. Shimy mają semantykę oryginałów w tym, co jest przedmiotem
 * dowodu:
 *   * `esc_html`/`esc_attr` → htmlspecialchars (dokładnie to robi WP),
 *   * `check_ajax_referer` → sprawdza nonce i KOŃCZY żądanie przy odmowie
 *     (WP robi wp_die) — dzięki temu regres bramki nonce jest wykrywalny
 *     testem, a nie tylko sondą na żywej instalacji (recenzja PM #212),
 *   * `wp_send_json_success/error` → kończą żądanie wyjątkiem niosącym
 *     payload i status (w WP kończą je die()).
 */

define( 'AVABLY_BOOKING_TESTSUITE', true );

// ---------------------------------------------------------------------
// Harness: przerwanie żądania (odpowiednik wp_die/die w WP)
// ---------------------------------------------------------------------

/** Odpowiedź JSON zakończona przez wp_send_json_*. */
class AvablyTestJsonResponse extends RuntimeException {
	public bool $success;
	public $payload;
	public int $status;

	public function __construct( bool $success, $payload, int $status ) {
		parent::__construct( 'json' );
		$this->success = $success;
		$this->payload = $payload;
		$this->status  = $status;
	}
}

/** Przerwanie żądania przez bramkę (odpowiednik wp_die z check_ajax_referer). */
class AvablyTestHalt extends RuntimeException {}

/** Stan atrapy WP — zerowany w setUp każdego testu. */
final class AvablyTestState {
	/** @var array<string,mixed> */
	public static array $options = array();
	/** @var array<string,mixed> */
	public static array $transients = array();
	/** Poprawny nonce oczekiwany przez shim check_ajax_referer. */
	public static string $validNonce = 'poprawny-nonce';
	/** Liczba wywołań nocache_headers() w bieżącym żądaniu. */
	public static int $nocacheCalls = 0;
	/** Czy bieżący użytkownik ma manage_options. */
	public static bool $canManageOptions = true;
	/** Atrapa klienta API podstawiana filtrem `avably_booking_api_client`. */
	public static $apiClient = null;
	/** Zarejestrowane wywołania add_options_page (capability itd.). */
	public static array $optionsPages = array();
	/** Żądania wyłączenia autoloadu opcji (wp_set_option_autoload). */
	public static array $autoloadCalls = array();

	public static function reset(): void {
		self::$options = array(
			'avably_booking_settings' => array(
				'api_url'    => 'https://api.example.test',
				'api_key'    => AVABLY_TEST_API_KEY,
				'key_prefix' => substr( AVABLY_TEST_API_KEY, 0, 13 ),
			),
		);
		self::$transients       = array();
		self::$nocacheCalls     = 0;
		self::$canManageOptions = true;
		self::$apiClient        = null;
		self::$optionsPages     = array();
		self::$autoloadCalls    = array();
		$_GET                   = array();
		$_POST                  = array();
		$_REQUEST               = array();
		$_SERVER['REQUEST_METHOD'] = 'GET';
	}
}

/**
 * Klucz API „zapisany w instalacji" — payload frontowy zbudowany przy TAK
 * ustawionej opcji nie ma prawa go nieść (dowód mutacyjny M1).
 */
const AVABLY_TEST_API_KEY = 'avbl_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

// --- Shimy WordPressa (tylko to, czego używa testowana logika) ---

function __( $text, $domain = null ) {
	return $text;
}

function esc_html( $text ) {
	return htmlspecialchars( (string) $text, ENT_QUOTES, 'UTF-8' );
}

function esc_attr( $text ) {
	return htmlspecialchars( (string) $text, ENT_QUOTES, 'UTF-8' );
}

function esc_html__( $text, $domain = null ) {
	return esc_html( $text );
}

function esc_url( $url ) {
	// Lustro semantyki WP w tym, co dowodzimy: dopuszczalne protokoły
	// (http/https/mailto/tel/ścieżka względna), reszta → pusty string.
	$url = trim( (string) $url );
	if ( '' === $url ) {
		return '';
	}
	if ( preg_match( '#^(https?:)?//#i', $url ) || str_starts_with( $url, '/' ) || str_starts_with( $url, '?' ) || str_starts_with( $url, '#' ) ) {
		return htmlspecialchars( $url, ENT_QUOTES, 'UTF-8' );
	}
	return '';
}

function add_query_arg( $key, $value, $url ) {
	$separator = str_contains( (string) $url, '?' ) ? '&' : '?';
	return $url . $separator . $key . '=' . $value;
}

function get_option( $name, $default = false ) {
	return AvablyTestState::$options[ $name ] ?? $default;
}

function update_option( $name, $value, $autoload = null ) {
	AvablyTestState::$options[ $name ] = $value;
	return true;
}

function apply_filters( $hook, $value ) {
	// Jedyny filtr używany przez testy: podstawienie atrapy klienta API.
	if ( 'avably_booking_api_client' === $hook && null !== AvablyTestState::$apiClient ) {
		return AvablyTestState::$apiClient;
	}
	return $value;
}

function wp_unslash( $value ) {
	return $value;
}

function current_time( $format ) {
	return date( $format );
}

function get_locale() {
	return 'pl_PL';
}

function current_user_can( $capability ) {
	return 'manage_options' === $capability ? AvablyTestState::$canManageOptions : false;
}

function add_options_page( $page_title, $menu_title, $capability, $slug, $callback ) {
	AvablyTestState::$optionsPages[] = array(
		'capability' => $capability,
		'slug'       => $slug,
	);
	return $slug;
}

function add_settings_error( $setting, $code, $message ) {
	return null;
}

function get_transient( $key ) {
	if ( ! isset( AvablyTestState::$transients[ $key ] ) ) {
		return false;
	}
	return AvablyTestState::$transients[ $key ];
}

function set_transient( $key, $value, $ttl = 0 ) {
	AvablyTestState::$transients[ $key ] = $value;
	return true;
}

function delete_transient( $key ) {
	unset( AvablyTestState::$transients[ $key ] );
	return true;
}

function nocache_headers() {
	AvablyTestState::$nocacheCalls++;
}

/**
 * Semantyka WP: przy złym/braku nonce wypisuje odmowę i KOŃCZY żądanie.
 * Tu kończy je wyjątkiem AvablyTestHalt — testy sprawdzają, że dalszy kod
 * (a więc i klient API) nigdy nie ruszył.
 */
function check_ajax_referer( $action, $query_arg = false, $die = true ) {
	$nonce = '';
	if ( $query_arg && isset( $_REQUEST[ $query_arg ] ) ) {
		$nonce = (string) $_REQUEST[ $query_arg ];
	}
	if ( $nonce === AvablyTestState::$validNonce ) {
		return 1;
	}
	if ( $die ) {
		throw new AvablyTestHalt( 'check_ajax_referer: odmowa' );
	}
	return false;
}

function wp_send_json_success( $data = null, $status_code = 200 ) {
	throw new AvablyTestJsonResponse( true, $data, $status_code );
}

function wp_send_json_error( $data = null, $status_code = 200 ) {
	throw new AvablyTestJsonResponse( false, $data, $status_code );
}

function wp_create_nonce( $action ) {
	return AvablyTestState::$validNonce;
}

function admin_url( $path = '' ) {
	return 'https://sklep.example/wp-admin/' . $path;
}

function settings_fields( $group ) {
	echo '<input type="hidden" name="option_page" value="' . esc_attr( $group ) . '">';
}

function submit_button( $text = null ) {
	echo '<button type="submit">' . esc_html( $text ?? 'Zapisz zmiany' ) . '</button>';
}

function register_setting( $group, $option, $args = array() ) {
	return true;
}

function add_action( $hook, $callback, $priority = 10, $args = 1 ) {
	return true;
}

function add_shortcode( $tag, $callback ) {
	return true;
}

function wp_set_option_autoload( $option, $autoload ) {
	AvablyTestState::$autoloadCalls[ $option ] = (bool) $autoload;
	return true;
}

// ---------------------------------------------------------------------
// Model transportu HTTP WP — dowód W1 (podążanie za przekierowaniem).
//
// Wierny w tym, co dowodzimy: WordPress domyślnie podąża za `redirection`
// przekierowaniami, PONOWNIE wysyłając nagłówki żądania (w tym Authorization)
// na host docelowy. Z `redirection => 0` nie podąża wcale. Model jest domyślnie
// bierny (żaden istniejący test nie woła http_transport), a test W1 programuje
// scenariusz 302 → host prywatny i sprawdza, że klucz nie opuszcza pierwotnego
// hosta.
// ---------------------------------------------------------------------

/** Odpowiednik WP_Error dla shimu (is_wp_error rozpoznaje po typie). */
final class AvablyTestWpError {
	public string $code;
	public function __construct( string $code ) {
		$this->code = $code;
	}
	public function get_error_code(): string {
		return $this->code;
	}
}

final class AvablyHttpModel {
	/** @var array<int,array{url:string,headers:array,redirection:int,safe:bool}> */
	public static array $calls = array();
	/** Host (pełny URL), który oddaje 302. */
	public static string $redirectFrom = '';
	/** Cel przekierowania (Location) — zwykle host prywatny. */
	public static string $redirectTo = '';
	/** Gdy ustawione, transport zwraca WP_Error o tym kodzie. */
	public static string $forceError = '';

	public static function reset(): void {
		self::$calls        = array();
		self::$redirectFrom = '';
		self::$redirectTo   = '';
		self::$forceError   = '';
	}

	public static function dispatch( bool $safe, string $url, array $args ) {
		$redirection = isset( $args['redirection'] ) ? (int) $args['redirection'] : 5;
		self::$calls[] = array(
			'url'         => $url,
			'headers'     => isset( $args['headers'] ) && is_array( $args['headers'] ) ? $args['headers'] : array(),
			'redirection' => $redirection,
			'safe'        => $safe,
		);
		if ( '' !== self::$forceError ) {
			return new AvablyTestWpError( self::$forceError );
		}
		if ( '' !== self::$redirectFrom && $url === self::$redirectFrom ) {
			if ( $redirection > 0 ) {
				// WP podąża za Location, przenosząc nagłówki na host docelowy.
				$next                = $args;
				$next['redirection'] = $redirection - 1;
				return self::dispatch( $safe, self::$redirectTo, $next );
			}
			// redirection => 0: oddaj 302 bez podążania.
			return array( 'code' => 302, 'body' => '' );
		}
		return array( 'code' => 200, 'body' => '{"products":[]}' );
	}
}

function wp_safe_remote_request( $url, $args = array() ) {
	return AvablyHttpModel::dispatch( true, (string) $url, is_array( $args ) ? $args : array() );
}

function wp_remote_request( $url, $args = array() ) {
	return AvablyHttpModel::dispatch( false, (string) $url, is_array( $args ) ? $args : array() );
}

function wp_remote_retrieve_response_code( $response ) {
	return is_array( $response ) && isset( $response['code'] ) ? $response['code'] : 0;
}

function wp_remote_retrieve_body( $response ) {
	return is_array( $response ) && isset( $response['body'] ) ? $response['body'] : '';
}

function is_wp_error( $thing ) {
	return $thing instanceof AvablyTestWpError;
}

// --- Klasy wtyczki ---

$includes = dirname( __DIR__ ) . '/includes/';
require_once $includes . 'class-avably-booking-contract.php';
require_once $includes . 'class-avably-booking-api-client.php';
require_once $includes . 'class-avably-booking-validator.php';
require_once $includes . 'class-avably-booking-renderer.php';
require_once $includes . 'class-avably-booking-settings.php';
require_once $includes . 'class-avably-booking-ajax.php';
require_once $includes . 'class-avably-booking-plugin.php';

/**
 * Atrapa klienta API z LICZNIKIEM wywołań — sedno dowodu bramki nonce:
 * testy sprawdzają nie kod odpowiedzi, tylko to, że klient NIE RUSZYŁ.
 */
class AvablySpyApiClient extends Avably_Booking_Api_Client {
	public int $calls = 0;
	/** @var array<int,string> */
	public array $methods = array();
	private array $response;

	public function __construct( array $response = array( 'ok' => true, 'data' => array(), 'error_code' => null ) ) {
		parent::__construct( 'https://api.example.test', AVABLY_TEST_API_KEY, static fn() => array( 'code' => 200, 'body' => '{}' ) );
		$this->response = $response;
	}

	public function get_catalog(): array {
		$this->calls++;
		$this->methods[] = 'catalog';
		return $this->response;
	}

	public function get_availability( string $product_id, string $start_date, string $end_date ): array {
		$this->calls++;
		$this->methods[] = 'availability';
		return $this->response;
	}

	public function create_reservation( array $body ): array {
		$this->calls++;
		$this->methods[] = 'reservation';
		return $this->response;
	}
}
