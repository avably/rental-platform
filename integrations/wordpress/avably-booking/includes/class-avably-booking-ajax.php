<?php
/**
 * Endpointy ajaxowe wtyczki (admin-ajax.php) — proxy SERVER-SIDE do API
 * Avably z nonce'em, ścisłym whitelistem parametrów i odpowiedziami
 * budowanymi z zamkniętych list pól.
 *
 * TO NIE JEST otwarte proxy (§5.2 briefu M2):
 *   - istnieją DOKŁADNIE trzy akcje (availability / month / reserve);
 *   - żadna nie przyjmuje ścieżki, URL-a ani nazwy endpointu — parametry to
 *     wyłącznie product_id (UUID), daty ISO i pola formularza rezerwacji;
 *   - wywołania do API idą przez Avably_Booking_Api_Client, który zna tylko
 *     trzy stałe ścieżki kontraktu v1;
 *   - odpowiedź do przeglądarki przechodzi przez whitelisty pól — surowe
 *     body API (i tym bardziej nagłówki z kluczem) nie wychodzą dalej.
 *
 * Dostępność jest odpytywana wyłącznie tędy (nigdy zapieczona w HTML-u
 * strony) — strona może stać za cache'em, dostępność nie może.
 */

if ( ! defined( 'ABSPATH' ) && ! defined( 'AVABLY_BOOKING_TESTSUITE' ) ) {
	exit;
}

class Avably_Booking_Ajax {

	public const NONCE_ACTION = 'avably_booking_flow';

	/** Maksymalny horyzont kalendarza: bieżący miesiąc + 12. */
	public const MONTH_HORIZON = 12;

	/** Czas życia cache'u miesiąca dostępności (sekundy). */
	public const MONTH_CACHE_TTL = 300;

	/**
	 * Dławienie rezerwacji PER ODWIEDZAJĄCY (okno stałe).
	 *
	 * DLACZEGO WTYCZKA MUSI LICZYĆ SAMA: limity API (ADR-108) mają dwa
	 * wymiary — klucz i IP — ale IP, które widzi nasze API, to adres SERWERA
	 * WordPressa, wspólny dla wszystkich odwiedzających tę stronę. Wymiar IP
	 * jest więc po tamtej stronie ślepy, a wymiar klucza (30 rezerwacji/h)
	 * chroni najemcę PRZED WYCZERPANIEM, nie przed jednym botem, który ten
	 * budżet zje. Ten licznik odcina pojedynczego napastnika ZANIM dotknie
	 * naszego API.
	 */
	public const RESERVE_RATE_LIMIT = 10;
	public const RESERVE_RATE_WINDOW = 3600;

	public static function register(): void {
		add_action( 'wp_ajax_avably_booking_availability', array( __CLASS__, 'handle_availability' ) );
		add_action( 'wp_ajax_nopriv_avably_booking_availability', array( __CLASS__, 'handle_availability' ) );
		add_action( 'wp_ajax_avably_booking_month', array( __CLASS__, 'handle_month' ) );
		add_action( 'wp_ajax_nopriv_avably_booking_month', array( __CLASS__, 'handle_month' ) );
		add_action( 'wp_ajax_avably_booking_reserve', array( __CLASS__, 'handle_reserve' ) );
		add_action( 'wp_ajax_nopriv_avably_booking_reserve', array( __CLASS__, 'handle_reserve' ) );
	}

	// ------------------------------------------------------------------
	// Czyste parsery parametrów (testowalne bez WordPressa) — whitelist:
	// zwracają WYŁĄCZNIE rozpoznane, zwalidowane pola; wszystko inne ginie.
	// ------------------------------------------------------------------

	/**
	 * Parametry akcji availability: product_id + start_date + end_date.
	 *
	 * @param array $params Surowe parametry żądania.
	 * @return array{product_id:string,start_date:string,end_date:string}|null
	 */
	public static function parse_availability_params( array $params ): ?array {
		$product_id = self::scalar( $params, 'product_id' );
		$start_date = self::scalar( $params, 'start_date' );
		$end_date   = self::scalar( $params, 'end_date' );

		if ( ! preg_match( Avably_Booking_Api_Client::UUID_PATTERN, $product_id ) ) {
			return null;
		}
		if ( ! Avably_Booking_Validator::is_iso_date( $start_date ) || ! Avably_Booking_Validator::is_iso_date( $end_date ) ) {
			return null;
		}
		if ( $end_date < $start_date ) {
			return null;
		}
		return array(
			'product_id' => strtolower( $product_id ),
			'start_date' => $start_date,
			'end_date'   => $end_date,
		);
	}

	/**
	 * Parametry akcji month: product_id + month (YYYY-MM) w horyzoncie
	 * [bieżący miesiąc, +MONTH_HORIZON].
	 *
	 * @param array  $params Surowe parametry żądania.
	 * @param string $today  Data odniesienia (YYYY-MM-DD) — wstrzykiwana w testach.
	 * @return array{product_id:string,month:string}|null
	 */
	public static function parse_month_params( array $params, string $today ): ?array {
		$product_id = self::scalar( $params, 'product_id' );
		$month      = self::scalar( $params, 'month' );

		if ( ! preg_match( Avably_Booking_Api_Client::UUID_PATTERN, $product_id ) ) {
			return null;
		}
		if ( ! preg_match( '/^\d{4}-(0[1-9]|1[0-2])$/', $month ) ) {
			return null;
		}
		$current = substr( $today, 0, 7 );
		if ( $month < $current ) {
			return null;
		}
		$horizon = date( 'Y-m', strtotime( $current . '-01 +' . self::MONTH_HORIZON . ' months' ) );
		if ( $month > $horizon ) {
			return null;
		}
		return array(
			'product_id' => strtolower( $product_id ),
			'month'      => $month,
		);
	}

	/**
	 * Rdzeń dławienia (czysty, testowalny): stan okna → decyzja + nowy stan.
	 *
	 * @param array{start:int,count:int}|null $state Stan z transientu.
	 * @return array{allowed:bool,state:array{start:int,count:int}}
	 */
	public static function next_rate_state( ?array $state, int $now, int $window, int $limit ): array {
		if ( ! is_array( $state ) || ! isset( $state['start'], $state['count'] ) || ( $now - (int) $state['start'] ) >= $window ) {
			$state = array(
				'start' => $now,
				'count' => 0,
			);
		}
		$count = (int) $state['count'] + 1;
		return array(
			'allowed' => $count <= $limit,
			'state'   => array(
				'start' => (int) $state['start'],
				'count' => $count,
			),
		);
	}

	/** Adres odwiedzającego — WYŁĄCZNIE do kubełka limitu (nie do autoryzacji). */
	public static function visitor_bucket( array $server ): string {
		$ip = isset( $server['REMOTE_ADDR'] ) && is_scalar( $server['REMOTE_ADDR'] )
			? (string) $server['REMOTE_ADDR']
			: 'unknown';
		// REMOTE_ADDR (a nie X-Forwarded-For): nagłówek klienta jest
		// podrabialny, więc dałby napastnikowi świeży licznik na żądanie.
		return md5( $ip );
	}

	/**
	 * Whitelist odpowiedzi availability: wyłącznie liczby dostępności.
	 *
	 * @return array{available_units:int,total_units:int}
	 */
	public static function pick_availability( array $data ): array {
		return array(
			'available_units' => isset( $data['available_units'] ) ? (int) $data['available_units'] : 0,
			'total_units'     => isset( $data['total_units'] ) ? (int) $data['total_units'] : 0,
		);
	}

	/**
	 * Whitelist odpowiedzi rezerwacji: podsumowanie zamówienia klienta —
	 * ZAMKNIĘTA lista pól kontraktu (bez pól diagnostycznych, bez uchwytów).
	 *
	 * @param array $data Odpowiedź 201 API (status/nextStep/order).
	 * @return array{order_number:string,start_date:string,end_date:string,payment_method:string,delivery_method:string,total_rental_grosze:int,total_deposit_grosze:int,delivery_grosze:int,currency:string}
	 */
	public static function pick_order_summary( array $data ): array {
		$order = isset( $data['order'] ) && is_array( $data['order'] ) ? $data['order'] : array();
		return array(
			'order_number'         => isset( $order['orderNumber'] ) ? (string) $order['orderNumber'] : '',
			'start_date'           => isset( $order['startDate'] ) ? (string) $order['startDate'] : '',
			'end_date'             => isset( $order['endDate'] ) ? (string) $order['endDate'] : '',
			'payment_method'       => isset( $order['paymentMethod'] ) ? (string) $order['paymentMethod'] : '',
			'delivery_method'      => isset( $order['deliveryMethod'] ) ? (string) $order['deliveryMethod'] : '',
			'total_rental_grosze'  => isset( $order['totalRentalGrosze'] ) ? (int) $order['totalRentalGrosze'] : 0,
			'total_deposit_grosze' => isset( $order['totalDepositGrosze'] ) ? (int) $order['totalDepositGrosze'] : 0,
			'delivery_grosze'      => isset( $order['deliveryGrosze'] ) ? (int) $order['deliveryGrosze'] : 0,
			'currency'             => isset( $order['currency'] ) ? (string) $order['currency'] : 'PLN',
		);
	}

	/**
	 * Lista dni miesiąca do odpytania (od dnia odniesienia, jeśli miesiąc
	 * bieżący — przeszłość nie jest rezerwowalna, więc jej nie odpytujemy).
	 *
	 * @return string[] Daty ISO.
	 */
	public static function month_days( string $month, string $today ): array {
		$first = $month . '-01';
		$count = (int) date( 't', strtotime( $first ) );
		$days  = array();
		for ( $i = 1; $i <= $count; $i++ ) {
			$day = sprintf( '%s-%02d', $month, $i );
			if ( $day < $today ) {
				continue;
			}
			$days[] = $day;
		}
		return $days;
	}

	// ------------------------------------------------------------------
	// Handlery WP (nonce => parsery => klient => whitelist odpowiedzi).
	// ------------------------------------------------------------------

	/** GET availability: dostępność zakresu dat dla produktu. */
	public static function handle_availability(): void {
		self::guard();
		$params = self::parse_availability_params( wp_unslash( $_GET ) );
		if ( null === $params ) {
			wp_send_json_error( array( 'message' => Avably_Booking_Contract::error_message( 'validation_failed' ) ), 400 );
		}

		$client = Avably_Booking_Plugin::api_client();
		$result = $client->get_availability( $params['product_id'], $params['start_date'], $params['end_date'] );
		if ( ! $result['ok'] ) {
			self::send_api_error( $result );
		}
		wp_send_json_success( self::pick_availability( (array) $result['data'] ) );
	}

	/** GET month: dostępność per dzień dla siatki kalendarza (cache transient). */
	public static function handle_month(): void {
		self::guard();
		$today  = current_time( 'Y-m-d' );
		$params = self::parse_month_params( wp_unslash( $_GET ), $today );
		if ( null === $params ) {
			wp_send_json_error( array( 'message' => Avably_Booking_Contract::error_message( 'validation_failed' ) ), 400 );
		}

		$cache_key = 'avably_bk_m_' . md5( $params['product_id'] . '|' . $params['month'] . '|' . $today );
		$cached    = get_transient( $cache_key );
		if ( is_array( $cached ) ) {
			wp_send_json_success( $cached );
		}

		$client = Avably_Booking_Plugin::api_client();
		$days   = array();
		foreach ( self::month_days( $params['month'], $today ) as $day ) {
			$result = $client->get_availability( $params['product_id'], $day, $day );
			if ( ! $result['ok'] ) {
				// Pierwszy błąd przerywa pętlę — komunikat ogólny zamiast
				// palenia limitu żądań na martwym kluczu/produkcie.
				self::send_api_error( $result );
			}
			$picked        = self::pick_availability( (array) $result['data'] );
			$days[ $day ] = $picked['available_units'];
		}

		$payload = array(
			'month' => $params['month'],
			'days'  => $days,
		);
		set_transient( $cache_key, $payload, self::MONTH_CACHE_TTL );
		wp_send_json_success( $payload );
	}

	/** POST reserve: walidacja formularza => rezerwacja w API => podsumowanie. */
	public static function handle_reserve(): void {
		self::guard();
		if ( ! isset( $_SERVER['REQUEST_METHOD'] ) || 'POST' !== $_SERVER['REQUEST_METHOD'] ) {
			wp_send_json_error( array( 'message' => Avably_Booking_Contract::error_message( 'validation_failed' ) ), 400 );
		}

		// Dławienie PRZED walidacją i przed dotknięciem API — patrz stała
		// RESERVE_RATE_LIMIT (IP widziane przez nasze API to adres serwera WP).
		$bucket    = 'avably_bk_rl_' . self::visitor_bucket( $_SERVER );
		$stored    = get_transient( $bucket );
		$decision  = self::next_rate_state(
			is_array( $stored ) ? $stored : null,
			time(),
			self::RESERVE_RATE_WINDOW,
			self::RESERVE_RATE_LIMIT
		);
		set_transient( $bucket, $decision['state'], self::RESERVE_RATE_WINDOW );
		if ( ! $decision['allowed'] ) {
			wp_send_json_error( array( 'message' => Avably_Booking_Contract::error_message( 'rate_limited' ) ), 429 );
		}

		$input     = wp_unslash( $_POST );
		$locale    = str_starts_with( (string) get_locale(), 'pl' ) ? 'pl' : 'en';
		$validated = Avably_Booking_Validator::validate( $input, Avably_Booking_Plugin::terms_version(), $locale );
		if ( ! $validated['ok'] ) {
			wp_send_json_error(
				array(
					'message' => Avably_Booking_Contract::error_message( 'validation_failed' ),
					'fields'  => Avably_Booking_Contract::field_messages( $validated['errors'] ),
				),
				400
			);
		}

		$client = Avably_Booking_Plugin::api_client();
		$result = $client->create_reservation( $validated['body'] );
		if ( ! $result['ok'] ) {
			self::send_api_error( $result );
		}

		wp_send_json_success( array( 'order' => self::pick_order_summary( (array) $result['data'] ) ) );
	}

	// ------------------------------------------------------------------

	/** Wspólna bramka: nonce + zakaz cache'owania odpowiedzi. */
	private static function guard(): void {
		nocache_headers();
		check_ajax_referer( self::NONCE_ACTION, 'nonce' );
	}

	/**
	 * Jednolita odmowa z API: kod kontraktu => komunikat bez szczegółów
	 * technicznych (mapa Avably_Booking_Contract). Kończy żądanie.
	 *
	 * @param array $result Wynik klienta (ok=false).
	 */
	private static function send_api_error( array $result ): void {
		$code    = isset( $result['error_code'] ) && is_string( $result['error_code'] ) ? $result['error_code'] : 'server_error';
		$payload = array(
			'message' => Avably_Booking_Contract::error_message( $code ),
			'code'    => in_array( $code, Avably_Booking_Contract::ERROR_CODES, true ) ? $code : 'server_error',
		);
		if ( isset( $result['fields'] ) && is_array( $result['fields'] ) ) {
			$payload['fields'] = Avably_Booking_Contract::field_messages( $result['fields'] );
		}
		$status_map = array(
			'unauthorized'        => 502, // Problem konfiguracji operatora, nie klienta końcowego.
			'store_unavailable'   => 503,
			'rate_limited'        => 429,
			'validation_failed'   => 400,
			'not_found'           => 404,
			'conflict'            => 409,
			'rejected'            => 422,
			'payment_unavailable' => 409,
			'server_error'        => 502,
		);
		$status = isset( $status_map[ $code ] ) ? $status_map[ $code ] : 502;
		wp_send_json_error( $payload, $status );
	}

	/** Parametr skalarny jako przycięty string (nie-skalar => pusty). */
	private static function scalar( array $params, string $key ): string {
		if ( ! isset( $params[ $key ] ) || ! is_scalar( $params[ $key ] ) ) {
			return '';
		}
		return trim( (string) $params[ $key ] );
	}
}
