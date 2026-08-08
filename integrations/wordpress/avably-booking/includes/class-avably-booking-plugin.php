<?php
/**
 * Bootstrap wtyczki: shortcode [avably_booking], blok Gutenberga (cienka
 * owijka shortcode'u), assety frontowe, no-cache dla stron z flow.
 *
 * GRANICA SEKRETU (§5.1 briefu M2): jedyne dane, które wtyczka przekazuje
 * do przeglądarki, buduje front_script_data() — klucz API nie jest jej
 * częścią i nigdy nie może być. Wywołania API dzieją się WYŁĄCZNIE w PHP
 * (Avably_Booking_Api_Client przez wp_safe_remote_request, bez podążania za
 * przekierowaniami — patrz http_transport()).
 */

if ( ! defined( 'ABSPATH' ) && ! defined( 'AVABLY_BOOKING_TESTSUITE' ) ) {
	exit;
}

class Avably_Booking_Plugin {

	public const SHORTCODE = 'avably_booking';

	/**
	 * Wersja regulaminu utrwalana na zamówieniu (kontrakt checkoutu wymaga
	 * niepustej wartości; storefront używa "1.0" — trzymamy tę samą oś).
	 */
	public const TERMS_VERSION = '1.0';

	/** TTL cache'u katalogu (transient) — krótki, bo ceny mogą się zmieniać. */
	public const CATALOG_CACHE_TTL = 60;

	public static function boot(): void {
		add_action( 'init', array( __CLASS__, 'register_public' ) );
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'maybe_enqueue_assets' ) );
		add_action( 'template_redirect', array( __CLASS__, 'maybe_disable_page_cache' ) );
		Avably_Booking_Settings::register();
		Avably_Booking_Ajax::register();
	}

	public static function register_public(): void {
		load_plugin_textdomain( 'avably-booking', false, dirname( plugin_basename( AVABLY_BOOKING_PLUGIN_FILE ) ) . '/languages' );
		add_shortcode( self::SHORTCODE, array( __CLASS__, 'render_shortcode' ) );

		// Blok Gutenberga = cienka owijka shortcode'u (rozstrzygnięcie
		// iteracji 1, ADR-110): render_callback woła dokładnie tę samą
		// ścieżkę renderowania.
		if ( function_exists( 'register_block_type' ) ) {
			register_block_type( AVABLY_BOOKING_PLUGIN_DIR . 'blocks/booking' );
		}
	}

	/** Wersja regulaminu (filtr pozwala nadpisać per wdrożenie). */
	public static function terms_version(): string {
		$version = apply_filters( 'avably_booking_terms_version', self::TERMS_VERSION );
		return is_string( $version ) && '' !== $version ? $version : self::TERMS_VERSION;
	}

	/**
	 * Produkcyjny klient API — klucz i URL z ustawień, transport WP HTTP.
	 *
	 * Filtr `avably_booking_api_client` pozwala podstawić własną implementację
	 * (używany przez suitę testów do atrapy z LICZNIKIEM wywołań — dowód, że
	 * bramka nonce zatrzymuje żądanie PRZED dotknięciem API).
	 */
	public static function api_client(): Avably_Booking_Api_Client {
		$settings = Avably_Booking_Settings::get();
		$client   = new Avably_Booking_Api_Client(
			$settings['api_url'],
			$settings['api_key'],
			array( __CLASS__, 'http_transport' )
		);
		$filtered = apply_filters( 'avably_booking_api_client', $client );
		return $filtered instanceof Avably_Booking_Api_Client ? $filtered : $client;
	}

	/**
	 * Transport HTTP: wp_safe_remote_request => { code, body } albo transport_error.
	 *
	 * OBRONA ANTY-SSRF (R10, ADR-110 decyzje R10):
	 *   - `wp_safe_remote_request()` (nie surowy wp_remote_request) włącza
	 *     `reject_unsafe_urls` — WordPress waliduje adres KAŻDEGO żądania po
	 *     resolucji DNS i odrzuca hosty prywatne/loopback/link-local. To warstwa,
	 *     która łapie W2 (nazwa domeny wskazująca na adres prywatny) w chwili
	 *     żądania, a nie tylko literał z ustawień;
	 *   - `redirection => 0` — żadnego podążania za `Location`. Bez tego API
	 *     oddające 302 na adres prywatny sprawiało, że WordPress szedł za
	 *     przekierowaniem, PONOWNIE wysyłając nagłówek `Authorization: Bearer
	 *     avbl_…` na host docelowy (pełny SSRF + eksfiltracja klucza najemcy).
	 *
	 * Kod 3xx to błąd KONFIGURACJI (API nie powinno przekierowywać), nie stan
	 * aplikacyjny: zgłaszamy go jak awarię transportu, żeby warstwa wyżej pokazała
	 * ogólny komunikat, a nie surowe „302". Klucz nigdy nie jedzie za Location.
	 *
	 * @param array $args method/url/timeout/headers/body z klienta.
	 * @return array
	 */
	public static function http_transport( array $args ): array {
		$response = wp_safe_remote_request(
			$args['url'],
			array(
				'method'             => $args['method'],
				'timeout'            => $args['timeout'],
				'headers'            => $args['headers'],
				'body'               => isset( $args['body'] ) ? $args['body'] : null,
				'redirection'        => 0,
				'reject_unsafe_urls' => true,
			)
		);
		if ( is_wp_error( $response ) ) {
			// Szczegół błędu transportu zostaje w PHP — do przeglądarki idzie
			// wyłącznie ogólny komunikat (mapowanie w warstwie ajax). Tu wpada
			// też adres odrzucony przez reject_unsafe_urls (host prywatny).
			return array( 'transport_error' => $response->get_error_code() );
		}
		$code = (int) wp_remote_retrieve_response_code( $response );
		if ( $code >= 300 && $code < 400 ) {
			// Przekierowanie z API = błąd konfiguracji; nie oddajemy surowego
			// „302" i nie podążamy za nim (redirection => 0 już to gwarantuje).
			return array( 'transport_error' => 'unexpected_redirect' );
		}
		return array(
			'code' => $code,
			'body' => (string) wp_remote_retrieve_body( $response ),
		);
	}

	// ------------------------------------------------------------------
	// Shortcode i widoki.
	// ------------------------------------------------------------------

	/** Render [avably_booking]: katalog albo widok produktu (?avably_product). */
	public static function render_shortcode(): string {
		$client = self::api_client();
		if ( ! $client->is_configured() ) {
			// Wskazówka wyłącznie dla zalogowanego administratora; goście
			// widzą neutralny komunikat.
			if ( function_exists( 'current_user_can' ) && current_user_can( 'manage_options' ) ) {
				return Avably_Booking_Renderer::render_error(
					__( 'Avably Booking is not configured yet. Set the API URL and API key in Settings → Avably Booking.', 'avably-booking' )
				);
			}
			return Avably_Booking_Renderer::render_error(
				Avably_Booking_Contract::error_message( 'store_unavailable' )
			);
		}

		$catalog = self::get_catalog_cached( $client );
		if ( null === $catalog['data'] ) {
			return Avably_Booking_Renderer::render_error(
				Avably_Booking_Contract::error_message( (string) $catalog['error_code'] )
			);
		}

		$base_url = self::current_page_url();

		$product_id = isset( $_GET['avably_product'] ) && is_scalar( $_GET['avably_product'] )
			? strtolower( trim( (string) wp_unslash( $_GET['avably_product'] ) ) )
			: '';
		if ( '' !== $product_id && preg_match( Avably_Booking_Api_Client::UUID_PATTERN, $product_id ) ) {
			$product = self::find_product( $catalog['data'], $product_id );
			if ( null !== $product ) {
				return Avably_Booking_Renderer::render_product( $product, $catalog['data'], $base_url );
			}
			return Avably_Booking_Renderer::render_error(
				Avably_Booking_Contract::error_message( 'not_found' )
			);
		}

		return Avably_Booking_Renderer::render_catalog( $catalog['data'], $base_url );
	}

	/**
	 * Dane dla skryptu frontowego — JEDYNA droga danych wtyczki do JS.
	 *
	 * ZAKAZ KONSTRUKCYJNY: klucz API (ani jego prefiks, ani URL API) nie
	 * jest częścią tego payloadu. Przeglądarka rozmawia wyłącznie z
	 * admin-ajax.php tej instalacji. Pilnuje tego test jednostkowy
	 * (dowód mutacyjny M1) i sonda §5.1.
	 *
	 * @param string $ajax_url URL admin-ajax.php.
	 * @param string $nonce    Nonce akcji flow.
	 * @return array
	 */
	public static function front_script_data( string $ajax_url, string $nonce ): array {
		return array(
			'ajaxUrl' => $ajax_url,
			'nonce'   => $nonce,
			'i18n'    => array(
				'available'      => __( 'Available', 'avably-booking' ),
				'unavailable'    => __( 'Unavailable', 'avably-booking' ),
				'checking'       => __( 'Checking availability…', 'avably-booking' ),
				'rangeAvailable' => __( 'Selected dates are available.', 'avably-booking' ),
				'rangeSoldOut'   => __( 'Selected dates are not available. Please pick different dates.', 'avably-booking' ),
				'unitsLeft'      => __( 'units available', 'avably-booking' ),
				'submitting'     => __( 'Submitting reservation…', 'avably-booking' ),
				'confirmedTitle' => __( 'Reservation confirmed', 'avably-booking' ),
				'orderNumber'    => __( 'Order number', 'avably-booking' ),
				'dates'          => __( 'Rental dates', 'avably-booking' ),
				'payment'        => __( 'Payment', 'avably-booking' ),
				'paymentTransfer' => __( 'Bank transfer — the store will contact you with payment details.', 'avably-booking' ),
				'paymentCod'     => __( 'Payment on pickup/delivery.', 'avably-booking' ),
				'rental'         => __( 'Rental total', 'avably-booking' ),
				'depositLabel'   => __( 'Deposit', 'avably-booking' ),
				'deliveryLabel'  => __( 'Delivery', 'avably-booking' ),
				'genericError'   => Avably_Booking_Contract::error_message( 'server_error' ),
				'monthNames'     => array(
					__( 'January', 'avably-booking' ),
					__( 'February', 'avably-booking' ),
					__( 'March', 'avably-booking' ),
					__( 'April', 'avably-booking' ),
					__( 'May', 'avably-booking' ),
					__( 'June', 'avably-booking' ),
					__( 'July', 'avably-booking' ),
					__( 'August', 'avably-booking' ),
					__( 'September', 'avably-booking' ),
					__( 'October', 'avably-booking' ),
					__( 'November', 'avably-booking' ),
					__( 'December', 'avably-booking' ),
				),
				'dayNames'       => array(
					__( 'Mo', 'avably-booking' ),
					__( 'Tu', 'avably-booking' ),
					__( 'We', 'avably-booking' ),
					__( 'Th', 'avably-booking' ),
					__( 'Fr', 'avably-booking' ),
					__( 'Sa', 'avably-booking' ),
					__( 'Su', 'avably-booking' ),
				),
			),
		);
	}

	/** Enqueue assetów tylko na stronach z shortcodem/blokiem. */
	public static function maybe_enqueue_assets(): void {
		if ( ! self::current_page_has_flow() ) {
			return;
		}
		wp_enqueue_style(
			'avably-booking',
			AVABLY_BOOKING_PLUGIN_URL . 'assets/booking.css',
			array(),
			AVABLY_BOOKING_VERSION
		);
		wp_enqueue_script(
			'avably-booking',
			AVABLY_BOOKING_PLUGIN_URL . 'assets/booking.js',
			array(),
			AVABLY_BOOKING_VERSION,
			true
		);
		wp_localize_script(
			'avably-booking',
			'avablyBooking',
			self::front_script_data(
				admin_url( 'admin-ajax.php' ),
				wp_create_nonce( Avably_Booking_Ajax::NONCE_ACTION )
			)
		);
	}

	/**
	 * Strony z flow rezerwacyjnym nie mogą być cache'owane (dynamiczny
	 * stan + świeży nonce): DONOTCACHEPAGE dla wtyczek cache +
	 * nocache_headers() dla cache'ów HTTP.
	 */
	public static function maybe_disable_page_cache(): void {
		if ( ! self::current_page_has_flow() ) {
			return;
		}
		if ( ! defined( 'DONOTCACHEPAGE' ) ) {
			define( 'DONOTCACHEPAGE', true );
		}
		nocache_headers();
	}

	// ------------------------------------------------------------------

	/** Czy bieżące zapytanie renderuje stronę z shortcodem/blokiem. */
	private static function current_page_has_flow(): bool {
		if ( ! function_exists( 'is_singular' ) || ! is_singular() ) {
			return false;
		}
		$post = get_post();
		if ( ! $post ) {
			return false;
		}
		$content = (string) $post->post_content;
		if ( function_exists( 'has_shortcode' ) && has_shortcode( $content, self::SHORTCODE ) ) {
			return true;
		}
		return function_exists( 'has_block' ) && has_block( 'avably/booking', $post );
	}

	/** Katalog z krótkim cache'em transientowym (odciąża API przy ruchu). */
	private static function get_catalog_cached( Avably_Booking_Api_Client $client ): array {
		$settings  = Avably_Booking_Settings::get();
		$cache_key = 'avably_bk_catalog_' . md5( $settings['api_url'] . '|' . $settings['key_prefix'] );
		$cached    = get_transient( $cache_key );
		if ( is_array( $cached ) ) {
			return array(
				'data'       => $cached,
				'error_code' => null,
			);
		}
		$result = $client->get_catalog();
		if ( $result['ok'] && is_array( $result['data'] ) ) {
			set_transient( $cache_key, $result['data'], self::CATALOG_CACHE_TTL );
			return array(
				'data'       => $result['data'],
				'error_code' => null,
			);
		}
		return array(
			'data'       => null,
			'error_code' => (string) $result['error_code'],
		);
	}

	/** Produkt z katalogu po id (bez dodatkowej rundy do API). */
	private static function find_product( array $catalog, string $product_id ): ?array {
		$products = isset( $catalog['products'] ) && is_array( $catalog['products'] ) ? $catalog['products'] : array();
		foreach ( $products as $product ) {
			if ( is_array( $product ) && isset( $product['id'] ) && strtolower( (string) $product['id'] ) === $product_id ) {
				return $product;
			}
		}
		return null;
	}

	/** URL bieżącej strony (permalink bez parametrów flow). */
	private static function current_page_url(): string {
		$permalink = function_exists( 'get_permalink' ) ? get_permalink() : false;
		return is_string( $permalink ) && '' !== $permalink ? $permalink : '/';
	}
}
