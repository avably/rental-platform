<?php
/**
 * Kontrakt publicznego API Avably v1 (ADR-108) po stronie wtyczki.
 *
 * Wtyczka jest KONSUMENTEM kontraktu: zna zamknięty zbiór kodów błędów
 * `{ error: { code, fields? } }` i mapuje je na komunikaty dla klienta
 * końcowego BEZ szczegółów technicznych (§5.5 briefu M2) — żaden komunikat
 * nie niesie statusu HTTP, treści odpowiedzi ani adresów.
 *
 * Komunikaty przechodzą przez gettext (text domain avably-booking):
 * domyślnie EN, tłumaczenie PL w languages/.
 */

if ( ! defined( 'ABSPATH' ) && ! defined( 'AVABLY_BOOKING_TESTSUITE' ) ) {
	exit;
}

class Avably_Booking_Contract {

	/** Zamknięty zbiór kodów błędów kontraktu v1 (ADR-108, decyzja 6). */
	public const ERROR_CODES = array(
		'unauthorized',
		'store_unavailable',
		'rate_limited',
		'validation_failed',
		'not_found',
		'conflict',
		'rejected',
		'payment_unavailable',
		'server_error',
	);

	/** Typy błędów pól mapy validation_failed (kontrakt checkoutu). */
	public const FIELD_ERROR_TYPES = array( 'required', 'invalid', 'too_long', 'not_allowed' );

	/**
	 * Komunikat dla klienta końcowego per kod błędu kontraktu.
	 *
	 * Nieznany kod (przyszłe rozszerzenie v1) dostaje komunikat ogólny —
	 * kontrakt v1 jest stabilny, ale wtyczka nie może się wywrócić na
	 * nowym kodzie.
	 */
	public static function error_message( string $code ): string {
		switch ( $code ) {
			case 'unauthorized':
				// Zły/odwołany klucz to sprawa operatora strony, nie klienta —
				// klient widzi tylko, że rezerwacja online chwilowo nie działa.
				return __( 'Online booking is temporarily unavailable. Please contact us directly.', 'avably-booking' );
			case 'store_unavailable':
				return __( 'The store is currently unavailable. Please try again later.', 'avably-booking' );
			case 'rate_limited':
				return __( 'Too many requests. Please wait a moment and try again.', 'avably-booking' );
			case 'validation_failed':
				return __( 'Please check the highlighted fields and try again.', 'avably-booking' );
			case 'not_found':
				return __( 'This product is no longer available.', 'avably-booking' );
			case 'conflict':
				return __( 'The selected dates have just been taken. Please refresh availability and pick different dates.', 'avably-booking' );
			case 'rejected':
				return __( 'The reservation could not be processed. Please verify your details and try again.', 'avably-booking' );
			case 'payment_unavailable':
				return __( 'Online payment is currently unavailable. Please choose a different payment method.', 'avably-booking' );
			case 'server_error':
			default:
				return __( 'Something went wrong. Please try again later.', 'avably-booking' );
		}
	}

	/**
	 * Komunikat per pole formularza dla mapy błędów validation_failed
	 * (pole => typ błędu). Zwraca listę komunikatów pole=>tekst.
	 *
	 * @param array<string,string> $fields Mapa pole => typ z kontraktu.
	 * @return array<string,string>
	 */
	public static function field_messages( array $fields ): array {
		$messages = array();
		foreach ( $fields as $field => $type ) {
			if ( ! is_string( $field ) || ! is_string( $type ) ) {
				continue;
			}
			$messages[ $field ] = self::field_message( $field, $type );
		}
		return $messages;
	}

	/** Komunikat pojedynczego pola. */
	public static function field_message( string $field, string $type ): string {
		$labels = array(
			'email'            => __( 'E-mail address', 'avably-booking' ),
			'fullName'         => __( 'Full name', 'avably-booking' ),
			'startDate'        => __( 'Start date', 'avably-booking' ),
			'endDate'          => __( 'End date', 'avably-booking' ),
			'deliveryMethod'   => __( 'Delivery method', 'avably-booking' ),
			'pickupLocationId' => __( 'Pickup location', 'avably-booking' ),
			'paymentMethod'    => __( 'Payment method', 'avably-booking' ),
			'items'            => __( 'Selected products', 'avably-booking' ),
			'terms'            => __( 'Terms acceptance', 'avably-booking' ),
			'phone'            => __( 'Phone number', 'avably-booking' ),
			'companyName'      => __( 'Company name', 'avably-booking' ),
			'nip'              => __( 'Tax ID', 'avably-booking' ),
			'addressStreet'    => __( 'Street address', 'avably-booking' ),
			'addressZip'       => __( 'Postal code', 'avably-booking' ),
			'addressCity'      => __( 'City', 'avably-booking' ),
			'locale'           => __( 'Language', 'avably-booking' ),
			'notes'            => __( 'Notes', 'avably-booking' ),
		);
		$label = isset( $labels[ $field ] ) ? $labels[ $field ] : $field;

		switch ( $type ) {
			case 'required':
				/* translators: %s: form field label. */
				return sprintf( __( '%s is required.', 'avably-booking' ), $label );
			case 'too_long':
				/* translators: %s: form field label. */
				return sprintf( __( '%s is too long.', 'avably-booking' ), $label );
			case 'not_allowed':
				/* translators: %s: form field label. */
				return sprintf( __( '%s is not allowed here.', 'avably-booking' ), $label );
			case 'invalid':
			default:
				/* translators: %s: form field label. */
				return sprintf( __( '%s is invalid.', 'avably-booking' ), $label );
		}
	}
}
