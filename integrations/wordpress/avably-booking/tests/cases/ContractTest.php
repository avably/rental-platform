<?php
/**
 * Mapa błędów kontraktu v1 => komunikaty dla klienta końcowego —
 * bez szczegółów technicznych (§5.5).
 */

use PHPUnit\Framework\TestCase;

final class ContractTest extends TestCase {

	public function test_every_contract_code_has_a_human_message(): void {
		foreach ( Avably_Booking_Contract::ERROR_CODES as $code ) {
			$message = Avably_Booking_Contract::error_message( $code );
			$this->assertNotSame( '', $message, $code );
			// Komunikat nie może być echem kodu maszynowego ani niesć
			// szczegółów technicznych.
			$this->assertStringNotContainsString( $code, $message, $code );
			$this->assertStringNotContainsString( 'HTTP', $message, $code );
			$this->assertDoesNotMatchRegularExpression( '/\b[45]\d\d\b/', $message, $code );
		}
	}

	public function test_store_unavailable_reads_as_store_closed(): void {
		// §5.5: 403 store_unavailable = czytelne „sklep niedostępny".
		$this->assertSame(
			'The store is currently unavailable. Please try again later.',
			Avably_Booking_Contract::error_message( 'store_unavailable' )
		);
	}

	public function test_unknown_code_falls_back_to_generic(): void {
		$this->assertSame(
			Avably_Booking_Contract::error_message( 'server_error' ),
			Avably_Booking_Contract::error_message( 'kod_z_przyszlosci' )
		);
	}

	public function test_field_messages_map_types_to_texts(): void {
		$messages = Avably_Booking_Contract::field_messages(
			[
				'email'     => 'invalid',
				'fullName'  => 'required',
				'notes'     => 'too_long',
				'weird'     => 'invalid',
			]
		);
		$this->assertSame( 'E-mail address is invalid.', $messages['email'] );
		$this->assertSame( 'Full name is required.', $messages['fullName'] );
		$this->assertSame( 'Notes is too long.', $messages['notes'] );
		// Nieznane pole dostaje komunikat z surową nazwą — ale wciąż bez
		// szczegółów technicznych.
		$this->assertSame( 'weird is invalid.', $messages['weird'] );
	}
}
