<?php
/**
 * Walidator formularza rezerwacji: wymagane pola, tor WYŁĄCZNIE offline
 * (iteracja 1), zamknięta lista pól body — nic obcego nie wychodzi do API.
 */

use PHPUnit\Framework\TestCase;

final class ValidatorTest extends TestCase {

	private const PRODUCT = '2a2a2a2a-1111-4222-8333-444444444444';
	private const LOCATION = '3b3b3b3b-1111-4222-8333-555555555555';

	private function valid_input( array $overrides = [] ): array {
		return array_merge(
			[
				'email'           => 'jan.kowalski@example.com',
				'full_name'       => 'Jan Kowalski',
				'product_id'      => self::PRODUCT,
				'quantity'        => '2',
				'start_date'      => '2026-09-01',
				'end_date'        => '2026-09-03',
				'delivery_method' => 'courier',
				'payment_method'  => 'transfer',
				'terms_accepted'  => '1',
			],
			$overrides
		);
	}

	public function test_happy_path_builds_contract_body(): void {
		$result = Avably_Booking_Validator::validate( $this->valid_input(), '1.0', 'pl' );

		$this->assertTrue( $result['ok'] );
		$this->assertSame( [], $result['errors'] );
		$this->assertSame(
			[
				'email'          => 'jan.kowalski@example.com',
				'fullName'       => 'Jan Kowalski',
				'startDate'      => '2026-09-01',
				'endDate'        => '2026-09-03',
				'deliveryMethod' => 'courier',
				'paymentMethod'  => 'transfer',
				'items'          => [ [ 'productId' => self::PRODUCT, 'quantity' => 2 ] ],
				'termsAccepted'  => true,
				'termsVersion'   => '1.0',
				'locale'         => 'pl',
			],
			$result['body']
		);
	}

	/** Obce pola wejścia (w tym tenant_id) NIE przechodzą do body. */
	public function test_foreign_input_fields_do_not_leak_into_body(): void {
		$input  = $this->valid_input(
			[
				'tenant_id'    => 'cudzy-tenant',
				'api_key'      => 'avbl_przemyt',
				'paymentBonus' => '100',
			]
		);
		$result = Avably_Booking_Validator::validate( $input, '1.0', 'pl' );

		$this->assertTrue( $result['ok'] );
		$serialized = json_encode( $result['body'] );
		$this->assertStringNotContainsString( 'tenant', $serialized );
		$this->assertStringNotContainsString( 'avbl_', $serialized );
		$this->assertStringNotContainsString( 'Bonus', $serialized );
	}

	/** ITERACJA 1: płatność online jest niereprezentowalna. */
	public function test_online_payment_is_rejected(): void {
		$result = Avably_Booking_Validator::validate(
			$this->valid_input( [ 'payment_method' => 'online' ] ),
			'1.0'
		);
		$this->assertFalse( $result['ok'] );
		$this->assertSame( 'invalid', $result['errors']['paymentMethod'] );
	}

	public function test_pickup_requires_location_and_other_methods_drop_it(): void {
		$missing = Avably_Booking_Validator::validate(
			$this->valid_input( [ 'delivery_method' => 'pickup' ] ),
			'1.0'
		);
		$this->assertFalse( $missing['ok'] );
		$this->assertSame( 'required', $missing['errors']['pickupLocationId'] );

		$with_location = Avably_Booking_Validator::validate(
			$this->valid_input(
				[
					'delivery_method'    => 'pickup',
					'pickup_location_id' => self::LOCATION,
				]
			),
			'1.0'
		);
		$this->assertTrue( $with_location['ok'] );
		$this->assertSame( self::LOCATION, $with_location['body']['pickupLocationId'] );

		// Punkt odbioru przy kurierze — pole ginie z body (serwer widzi
		// czysty kontrakt, nie dostaje not_allowed za nasz formularz).
		$courier = Avably_Booking_Validator::validate(
			$this->valid_input( [ 'pickup_location_id' => self::LOCATION ] ),
			'1.0'
		);
		$this->assertTrue( $courier['ok'] );
		$this->assertArrayNotHasKey( 'pickupLocationId', $courier['body'] );
	}

	public function test_dates_validation(): void {
		$reversed = Avably_Booking_Validator::validate(
			$this->valid_input(
				[
					'start_date' => '2026-09-05',
					'end_date'   => '2026-09-01',
				]
			),
			'1.0'
		);
		$this->assertSame( 'invalid', $reversed['errors']['endDate'] );

		$not_a_date = Avably_Booking_Validator::validate(
			$this->valid_input( [ 'start_date' => '2026-02-31' ] ),
			'1.0'
		);
		$this->assertSame( 'invalid', $not_a_date['errors']['startDate'] );

		$missing = Avably_Booking_Validator::validate(
			$this->valid_input( [ 'end_date' => '' ] ),
			'1.0'
		);
		$this->assertSame( 'required', $missing['errors']['endDate'] );
	}

	public function test_required_and_format_gates(): void {
		$result = Avably_Booking_Validator::validate(
			[
				'email'          => 'to-nie-email',
				'terms_accepted' => '0',
			],
			'1.0'
		);
		$this->assertFalse( $result['ok'] );
		$this->assertSame( 'invalid', $result['errors']['email'] );
		$this->assertSame( 'required', $result['errors']['fullName'] );
		$this->assertSame( 'invalid', $result['errors']['items'] );
		$this->assertSame( 'required', $result['errors']['deliveryMethod'] );
		$this->assertSame( 'required', $result['errors']['paymentMethod'] );
		$this->assertSame( 'required', $result['errors']['terms'] );
	}

	public function test_quantity_bounds(): void {
		foreach ( [ '0', '101', '-1' ] as $quantity ) {
			$result = Avably_Booking_Validator::validate(
				$this->valid_input( [ 'quantity' => $quantity ] ),
				'1.0'
			);
			$this->assertSame( 'invalid', $result['errors']['items'], "quantity={$quantity}" );
		}
	}

	public function test_optional_phone_and_notes(): void {
		$with = Avably_Booking_Validator::validate(
			$this->valid_input(
				[
					'phone' => '+48 600 700 800',
					'notes' => 'Proszę o odbiór po 17:00.',
				]
			),
			'1.0'
		);
		$this->assertTrue( $with['ok'] );
		$this->assertSame( '+48 600 700 800', $with['body']['phone'] );

		$short_phone = Avably_Booking_Validator::validate(
			$this->valid_input( [ 'phone' => '12' ] ),
			'1.0'
		);
		$this->assertSame( 'invalid', $short_phone['errors']['phone'] );

		$long_notes = Avably_Booking_Validator::validate(
			$this->valid_input( [ 'notes' => str_repeat( 'a', 2001 ) ] ),
			'1.0'
		);
		$this->assertSame( 'too_long', $long_notes['errors']['notes'] );
	}

	public function test_unknown_locale_falls_back_to_pl(): void {
		$result = Avably_Booking_Validator::validate( $this->valid_input(), '1.0', 'de' );
		$this->assertSame( 'pl', $result['body']['locale'] );
	}
}
