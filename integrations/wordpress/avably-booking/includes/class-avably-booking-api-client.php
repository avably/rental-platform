<?php
/**
 * Klient publicznego API Avably v1 (ADR-108) — WYŁĄCZNIE server-side.
 *
 * Konstrukcja bezpieczeństwa (§5 briefu M2):
 *   - trzy STAŁE ścieżki kontraktu (catalog/availability/reservations) —
 *     klasa nie ma żadnej metody przyjmującej ścieżkę ani URL z zewnątrz,
 *     więc „otwarte proxy" jest niereprezentowalne w jej interfejsie;
 *   - parametry wchodzą do URL-a dopiero PO walidacji formatu (UUID, data
 *     ISO) i przez rawurlencode — wejście nie ma jak przemycić separatorów;
 *   - klucz API żyje w tej klasie i wychodzi wyłącznie nagłówkiem
 *     Authorization do BAZOWEGO URL-a z ustawień — nigdy do przeglądarki
 *     (odpowiedzi klienta nie niosą nagłówków żądania).
 *
 * Transport jest wstrzykiwany (callable), więc logika jest testowalna
 * phpunitem bez WordPressa; produkcyjny transport to wp_safe_remote_request
 * z redirection => 0 (patrz Avably_Booking_Plugin::http_transport()).
 */

if ( ! defined( 'ABSPATH' ) && ! defined( 'AVABLY_BOOKING_TESTSUITE' ) ) {
	exit;
}

class Avably_Booking_Api_Client {

	/** Format surowego klucza API (ADR-108): prefiks produktowy + 64 hex. */
	public const API_KEY_PATTERN = '/^avbl_[0-9a-f]{64}$/';

	/** Format identyfikatora produktu (UUID) — bramka PRZED budową URL-a. */
	public const UUID_PATTERN = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i';

	/** Format daty ISO (YYYY-MM-DD) — bramka PRZED budową URL-a. */
	public const ISO_DATE_PATTERN = '/^\d{4}-\d{2}-\d{2}$/';

	/**
	 * Timeouty transportu per typ ścieżki (R11, ADR-114): odczyty (katalog,
	 * dostępność) są wołane przez kalendarz wielokrotnie — długi timeout
	 * zamieniał wolne API w zajętego workera PHP (audyt: ~60 s na jedno
	 * żądanie month). Zapis rezerwacji zostaje przy dłuższym timeoucie,
	 * bo przerwanie w połowie zostawia klienta bez numeru zamówienia,
	 * które mogło powstać.
	 */
	public const TIMEOUT_READ  = 5;
	public const TIMEOUT_WRITE = 15;

	/** Zamknięty zbiór ścieżek kontraktu v1 — jedyne, co klient umie wołać. */
	private const PATH_CATALOG      = '/api/v1/catalog';
	private const PATH_AVAILABILITY = '/api/v1/availability';
	private const PATH_RESERVATIONS = '/api/v1/reservations';

	private string $base_url;
	private string $api_key;
	/** @var callable(array):array Transport HTTP: args => ['code'=>int,'body'=>string] lub ['transport_error'=>string]. */
	private $transport;

	public function __construct( string $base_url, string $api_key, callable $transport ) {
		$this->base_url  = rtrim( trim( $base_url ), '/' );
		$this->api_key   = trim( $api_key );
		$this->transport = $transport;
	}

	/** Czy konfiguracja pozwala w ogóle wołać API (URL http(s) + klucz w formacie). */
	public function is_configured(): bool {
		if ( ! preg_match( '#^https?://#i', $this->base_url ) ) {
			return false;
		}
		return (bool) preg_match( self::API_KEY_PATTERN, $this->api_key );
	}

	/**
	 * GET /api/v1/catalog — katalog najemcy.
	 *
	 * @return array{ok:bool, data:?array, error_code:?string}
	 */
	public function get_catalog(): array {
		return $this->request( 'GET', self::PATH_CATALOG, array(), null );
	}

	/**
	 * GET /api/v1/availability — dostępność produktu w zakresie INCLUSIVE.
	 *
	 * @return array{ok:bool, data:?array, error_code:?string}
	 */
	public function get_availability( string $product_id, string $start_date, string $end_date ): array {
		// Walidacja PRZED budową URL-a — śmieć nie dolatuje nawet do transportu.
		if ( ! preg_match( self::UUID_PATTERN, $product_id ) ) {
			return self::failure( 'validation_failed' );
		}
		if ( ! preg_match( self::ISO_DATE_PATTERN, $start_date ) || ! preg_match( self::ISO_DATE_PATTERN, $end_date ) ) {
			return self::failure( 'validation_failed' );
		}
		if ( $end_date < $start_date ) {
			return self::failure( 'validation_failed' );
		}
		return $this->request(
			'GET',
			self::PATH_AVAILABILITY,
			array(
				'product_id' => $product_id,
				'start_date' => $start_date,
				'end_date'   => $end_date,
			),
			null
		);
	}

	/**
	 * POST /api/v1/reservations — złożenie rezerwacji.
	 *
	 * Body buduje WYŁĄCZNIE walidator (Avably_Booking_Validator) — ta metoda
	 * nie przyjmuje surowego wejścia formularza.
	 *
	 * @param array $body Znormalizowane body kontraktu CheckoutInput.
	 * @return array{ok:bool, data:?array, error_code:?string, fields?:array<string,string>}
	 */
	public function create_reservation( array $body ): array {
		return $this->request( 'POST', self::PATH_RESERVATIONS, array(), $body );
	}

	/**
	 * Jedyna droga do transportu — ścieżka pochodzi ZAWSZE ze stałych klasy.
	 *
	 * @param array<string,string> $query Parametry zapytania (już zwalidowane).
	 */
	private function request( string $method, string $path, array $query, ?array $body ): array {
		if ( ! $this->is_configured() ) {
			return self::failure( 'unauthorized' );
		}

		$url = $this->base_url . $path;
		if ( array() !== $query ) {
			$pairs = array();
			foreach ( $query as $key => $value ) {
				$pairs[] = rawurlencode( (string) $key ) . '=' . rawurlencode( (string) $value );
			}
			$url .= '?' . implode( '&', $pairs );
		}

		$args = array(
			'method'  => $method,
			'url'     => $url,
			// Odczyt (GET) = krótki timeout; zapis (POST) = długi (R11).
			'timeout' => 'POST' === $method ? self::TIMEOUT_WRITE : self::TIMEOUT_READ,
			'headers' => array(
				'Authorization' => 'Bearer ' . $this->api_key,
				'Accept'        => 'application/json',
			),
		);
		if ( null !== $body ) {
			$args['headers']['Content-Type'] = 'application/json';
			$args['body']                    = (string) json_encode( $body );
		}

		$response = call_user_func( $this->transport, $args );

		// Awaria transportu (timeout/DNS) => komunikat ogólny, zero szczegółów.
		if ( ! is_array( $response ) || isset( $response['transport_error'] ) || ! isset( $response['code'], $response['body'] ) ) {
			return self::failure( 'server_error' );
		}

		$status  = (int) $response['code'];
		$decoded = json_decode( (string) $response['body'], true );

		if ( $status >= 200 && $status < 300 ) {
			if ( ! is_array( $decoded ) ) {
				return self::failure( 'server_error' );
			}
			return array(
				'ok'         => true,
				'data'       => $decoded,
				'error_code' => null,
			);
		}

		// Błąd kontraktu v1: { error: { code, fields? } }. Kod spoza zbioru
		// (albo body bez kształtu) traktujemy jak server_error — komunikaty
		// buduje Avably_Booking_Contract, nigdy echo odpowiedzi.
		$code   = 'server_error';
		$fields = null;
		if ( is_array( $decoded ) && isset( $decoded['error'] ) && is_array( $decoded['error'] ) ) {
			$raw_code = isset( $decoded['error']['code'] ) ? (string) $decoded['error']['code'] : '';
			if ( in_array( $raw_code, Avably_Booking_Contract::ERROR_CODES, true ) ) {
				$code = $raw_code;
			}
			if ( isset( $decoded['error']['fields'] ) && is_array( $decoded['error']['fields'] ) ) {
				$fields = array();
				foreach ( $decoded['error']['fields'] as $field => $type ) {
					if ( is_string( $field ) && is_string( $type )
						&& in_array( $type, Avably_Booking_Contract::FIELD_ERROR_TYPES, true ) ) {
						$fields[ $field ] = $type;
					}
				}
			}
		}

		$failure = self::failure( $code );
		if ( null !== $fields ) {
			$failure['fields'] = $fields;
		}
		return $failure;
	}

	/** Jednolity kształt odmowy. */
	private static function failure( string $code ): array {
		return array(
			'ok'         => false,
			'data'       => null,
			'error_code' => $code,
		);
	}
}
