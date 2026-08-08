<?php
/**
 * Klient API v1: stałe ścieżki kontraktu, walidacja parametrów PRZED
 * transportem, mapowanie błędów kontraktu, nagłówek Bearer.
 *
 * Dowód §5.2 (otwarte proxy niereprezentowalne) + cel mutacji M2.
 */

use PHPUnit\Framework\TestCase;

final class ApiClientTest extends TestCase {

	private const KEY = 'avbl_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
	private const PRODUCT = '2a2a2a2a-1111-4222-8333-444444444444';

	/** @var array<int,array> Zarejestrowane wywołania transportu. */
	private array $calls = [];

	private function client( array $response = [ 'code' => 200, 'body' => '{}' ], string $key = self::KEY, string $base = 'https://api.example.test' ): Avably_Booking_Api_Client {
		$this->calls = [];
		return new Avably_Booking_Api_Client(
			$base,
			$key,
			function ( array $args ) use ( $response ) {
				$this->calls[] = $args;
				return $response;
			}
		);
	}

	public function test_catalog_uses_fixed_path_and_bearer_header(): void {
		$client = $this->client( [ 'code' => 200, 'body' => '{"products":[]}' ] );
		$result = $client->get_catalog();

		$this->assertTrue( $result['ok'] );
		$this->assertCount( 1, $this->calls );
		$this->assertSame( 'https://api.example.test/api/v1/catalog', $this->calls[0]['url'] );
		$this->assertSame( 'Bearer ' . self::KEY, $this->calls[0]['headers']['Authorization'] );
	}

	public function test_availability_uses_fixed_path_with_encoded_params(): void {
		$client = $this->client( [ 'code' => 200, 'body' => '{"available_units":1,"total_units":2}' ] );
		$result = $client->get_availability( self::PRODUCT, '2026-09-01', '2026-09-03' );

		$this->assertTrue( $result['ok'] );
		$url = $this->calls[0]['url'];
		$this->assertStringStartsWith( 'https://api.example.test/api/v1/availability?', $url );
		$this->assertStringContainsString( 'product_id=' . self::PRODUCT, $url );
		$this->assertStringContainsString( 'start_date=2026-09-01', $url );
		$this->assertStringContainsString( 'end_date=2026-09-03', $url );
	}

	public function test_reservation_uses_fixed_path_and_json_body(): void {
		$client = $this->client( [ 'code' => 201, 'body' => '{"status":"success"}' ] );
		$result = $client->create_reservation( [ 'email' => 'a@b.pl' ] );

		$this->assertTrue( $result['ok'] );
		$this->assertSame( 'https://api.example.test/api/v1/reservations', $this->calls[0]['url'] );
		$this->assertSame( 'POST', $this->calls[0]['method'] );
		$this->assertSame( '{"email":"a@b.pl"}', $this->calls[0]['body'] );
		$this->assertSame( 'application/json', $this->calls[0]['headers']['Content-Type'] );
	}

	/**
	 * Sedno §5.2: parametry-śmieci (w tym próby wstrzyknięcia ścieżki)
	 * są odrzucane PRZED transportem — żadne żądanie nie wychodzi.
	 * Dowód mutacyjny M2: zdjęcie bramki formatu pali te asercje.
	 */
	public function test_availability_rejects_path_injection_without_calling_transport(): void {
		$attacks = [
			'../secrets',
			'catalog',
			self::PRODUCT . '/../../admin',
			self::PRODUCT . '?x=1',
			self::PRODUCT . '#frag',
			'',
			'not-a-uuid',
		];
		foreach ( $attacks as $attack ) {
			$client = $this->client();
			$result = $client->get_availability( $attack, '2026-09-01', '2026-09-02' );
			$this->assertFalse( $result['ok'], "wejście: {$attack}" );
			$this->assertSame( 'validation_failed', $result['error_code'], "wejście: {$attack}" );
			$this->assertCount( 0, $this->calls, "transport zawołany dla: {$attack}" );
		}
	}

	public function test_availability_rejects_bad_dates_without_calling_transport(): void {
		$cases = [
			[ '2026-9-1', '2026-09-02' ],
			[ '2026-09-01', 'zaraz' ],
			[ '2026-09-05', '2026-09-01' ], // zakres odwrócony
			[ "2026-09-01'--", '2026-09-02' ],
		];
		foreach ( $cases as [ $start, $end ] ) {
			$client = $this->client();
			$result = $client->get_availability( self::PRODUCT, $start, $end );
			$this->assertFalse( $result['ok'] );
			$this->assertSame( 'validation_failed', $result['error_code'] );
			$this->assertCount( 0, $this->calls );
		}
	}

	public function test_unconfigured_client_never_calls_transport(): void {
		foreach ( [ [ 'zly-klucz', 'https://api.example.test' ], [ self::KEY, 'ftp://api.example.test' ], [ '', 'https://api.example.test' ] ] as [ $key, $base ] ) {
			$client = $this->client( [ 'code' => 200, 'body' => '{}' ], $key, $base );
			$result = $client->get_catalog();
			$this->assertFalse( $result['ok'] );
			$this->assertSame( 'unauthorized', $result['error_code'] );
			$this->assertCount( 0, $this->calls );
		}
	}

	public function test_maps_contract_error_codes(): void {
		$cases = [
			[ 401, 'unauthorized' ],
			[ 403, 'store_unavailable' ],
			[ 429, 'rate_limited' ],
			[ 404, 'not_found' ],
			[ 409, 'conflict' ],
			[ 422, 'rejected' ],
			[ 500, 'server_error' ],
		];
		foreach ( $cases as [ $status, $code ] ) {
			$client = $this->client( [ 'code' => $status, 'body' => json_encode( [ 'error' => [ 'code' => $code ] ] ) ] );
			$result = $client->get_catalog();
			$this->assertFalse( $result['ok'] );
			$this->assertSame( $code, $result['error_code'], "status {$status}" );
		}
	}

	public function test_validation_failed_carries_whitelisted_fields(): void {
		$body   = json_encode(
			[
				'error' => [
					'code'   => 'validation_failed',
					'fields' => [
						'email'   => 'invalid',
						'items'   => 'required',
						'zlyTyp'  => 'wybuch', // typ spoza kontraktu — ginie
						'x'       => [ 'tablica' ], // nie-string — ginie
					],
				],
			]
		);
		$client = $this->client( [ 'code' => 422, 'body' => $body ] );
		$result = $client->create_reservation( [ 'email' => 'x' ] );

		$this->assertSame( 'validation_failed', $result['error_code'] );
		$this->assertSame( [ 'email' => 'invalid', 'items' => 'required' ], $result['fields'] );
	}

	public function test_unknown_error_code_and_garbage_become_server_error(): void {
		foreach ( [
			[ 'code' => 418, 'body' => json_encode( [ 'error' => [ 'code' => 'czajnik' ] ] ) ],
			[ 'code' => 502, 'body' => '<html>bad gateway</html>' ],
			[ 'code' => 200, 'body' => 'nie-json' ],
			[ 'transport_error' => 'http_request_failed' ],
		] as $response ) {
			$client = $this->client( $response );
			$result = $client->get_catalog();
			$this->assertFalse( $result['ok'] );
			$this->assertSame( 'server_error', $result['error_code'] );
		}
	}
}
