<?php
/**
 * Walidacja formularza rezerwacji PO STRONIE WTYCZKI (lustro minimalne
 * kontraktu CheckoutInput z ADR-108) i budowa znormalizowanego body.
 *
 * Serwer Avably i tak waliduje wszystko (checkoutSchema) — ta warstwa
 * istnieje, żeby klient końcowy dostał komunikat przy polu bez rundy
 * do API oraz żeby do API NIE wychodziło nic spoza zamkniętej listy pól.
 *
 * ITERACJA 1 (M2): metody płatności WYŁĄCZNIE offline — `transfer` i `cod`.
 * `online` jest tu niereprezentowalne (checkout online w ramce = M4).
 */

if ( ! defined( 'ABSPATH' ) && ! defined( 'AVABLY_BOOKING_TESTSUITE' ) ) {
	exit;
}

class Avably_Booking_Validator {

	/** Metody płatności iteracji 1 — tor offline kontraktu (ADR-066/ADR-108). */
	public const OFFLINE_PAYMENT_METHODS = array( 'transfer', 'cod' );

	/** Metody dostawy kontraktu (lustro CHECK orders.delivery_method). */
	public const DELIVERY_METHODS = array( 'pickup', 'courier', 'parcel_locker', 'own_delivery' );

	/** Prefiks pól własnych w formularzu — ten sam klucz, którym API odsyła błędy. */
	public const CUSTOM_FIELD_PREFIX = 'cf_';

	/**
	 * Sufit liczby pól własnych w jednym żądaniu.
	 *
	 * Nie jest lustrem żadnej reguły serwera (tam granicą jest ROZMIAR mapy,
	 * 8 kB kolumny) — jest tarczą wtyczki: bez niego skrypt mógłby wysłać
	 * dziesiątki tysięcy kluczy `cf_*` i zamienić bramkę walidacji w koszt.
	 * Żaden realny najemca nie ma 60 pól w zamawianiu.
	 */
	public const CUSTOM_FIELDS_MAX = 60;

	/**
	 * Waliduje surowe wejście formularza i buduje body rezerwacji.
	 *
	 * @param array  $input         Surowe pola (już unslashed).
	 * @param string $terms_version Wersja regulaminu utrwalana na zamówieniu.
	 * @param string $locale        Locale komunikatów zamówienia ('pl'|'en').
	 * @return array{ok:bool, errors:array<string,string>, body:?array}
	 *         errors: mapa pole => typ błędu ('required'|'invalid'|'too_long'),
	 *         klucze pól jak w kontrakcie checkoutu.
	 */
	public static function validate( array $input, string $terms_version, string $locale = 'pl' ): array {
		$errors = array();

		$email = self::text( $input, 'email', 320 );
		if ( '' === $email ) {
			$errors['email'] = 'required';
		} elseif ( false === filter_var( $email, FILTER_VALIDATE_EMAIL ) ) {
			$errors['email'] = 'invalid';
		}

		$full_name = self::text( $input, 'full_name', 200 );
		if ( '' === $full_name ) {
			$errors['fullName'] = 'required';
		} elseif ( mb_strlen( $full_name ) > 200 ) {
			$errors['fullName'] = 'too_long';
		}

		$product_id = self::text( $input, 'product_id', 64 );
		$quantity   = isset( $input['quantity'] ) ? (int) $input['quantity'] : 1;
		if ( ! preg_match( Avably_Booking_Api_Client::UUID_PATTERN, $product_id ) ) {
			$errors['items'] = 'invalid';
		} elseif ( $quantity < 1 || $quantity > 100 ) {
			$errors['items'] = 'invalid';
		}

		$start_date = self::text( $input, 'start_date', 10 );
		$end_date   = self::text( $input, 'end_date', 10 );
		if ( ! self::is_iso_date( $start_date ) ) {
			$errors['startDate'] = '' === $start_date ? 'required' : 'invalid';
		}
		if ( ! self::is_iso_date( $end_date ) ) {
			$errors['endDate'] = '' === $end_date ? 'required' : 'invalid';
		}
		// Zakres INCLUSIVE jak w kontrakcie — odwrócony to błąd daty końca.
		if ( ! isset( $errors['startDate'], $errors['endDate'] ) && self::is_iso_date( $start_date ) && self::is_iso_date( $end_date ) && $end_date < $start_date ) {
			$errors['endDate'] = 'invalid';
		}

		$delivery_method = self::text( $input, 'delivery_method', 32 );
		if ( '' === $delivery_method ) {
			$errors['deliveryMethod'] = 'required';
		} elseif ( ! in_array( $delivery_method, self::DELIVERY_METHODS, true ) ) {
			$errors['deliveryMethod'] = 'invalid';
		}

		$pickup_location_id = self::text( $input, 'pickup_location_id', 64 );
		if ( 'pickup' === $delivery_method ) {
			if ( '' === $pickup_location_id ) {
				$errors['pickupLocationId'] = 'required';
			} elseif ( ! preg_match( Avably_Booking_Api_Client::UUID_PATTERN, $pickup_location_id ) ) {
				$errors['pickupLocationId'] = 'invalid';
			}
		}

		// TOR OFFLINE: iteracja 1 przyjmuje wyłącznie transfer/cod — wartość
		// `online` (i każda inna) jest odrzucana TUTAJ, zanim zobaczy ją API.
		$payment_method = self::text( $input, 'payment_method', 32 );
		if ( '' === $payment_method ) {
			$errors['paymentMethod'] = 'required';
		} elseif ( ! in_array( $payment_method, self::OFFLINE_PAYMENT_METHODS, true ) ) {
			$errors['paymentMethod'] = 'invalid';
		}

		if ( empty( $input['terms_accepted'] ) || '1' !== (string) $input['terms_accepted'] ) {
			$errors['terms'] = 'required';
		}

		$phone = self::text( $input, 'phone', 64 );
		if ( '' !== $phone && ( mb_strlen( $phone ) < 4 || mb_strlen( $phone ) > 32 ) ) {
			$errors['phone'] = 'invalid';
		}

		$notes = self::text( $input, 'notes', 4000 );
		if ( mb_strlen( $notes ) > 2000 ) {
			$errors['notes'] = 'too_long';
		}

		// --- POLA WŁASNE (C6-A3, ADR-121) ---
		//
		// Wtyczka NIE ZNA definicji w tym miejscu (walidator dostaje surowe
		// wejście, nie katalog), więc sprawdza wyłącznie KSZTAŁT: klucz musi
		// być identyfikatorem, wartość skalarem o rozsądnej długości.
		// O tym, czy pole istnieje u tego najemcy, jest polem ZAMAWIANIA
		// i czy wartość pasuje do typu, rozstrzyga serwer — i to jest właściwy
		// podział: wtyczka stoi na cudzej stronie i nie jest bramką.
		$custom_fields = array();
		foreach ( $input as $key => $value ) {
			if ( ! is_string( $key ) || 0 !== strpos( $key, self::CUSTOM_FIELD_PREFIX ) ) {
				continue;
			}
			$definition_id = substr( $key, strlen( self::CUSTOM_FIELD_PREFIX ) );
			if ( ! preg_match( Avably_Booking_Api_Client::UUID_PATTERN, $definition_id ) ) {
				// Klucz z prefiksem, ale bez identyfikatora — nie pochodzi
				// z naszego formularza. Milczące pominięcie wystarcza: nie ma
				// pola, pod którym dałoby się pokazać komunikat.
				continue;
			}
			if ( ! is_scalar( $value ) ) {
				$errors[ $key ] = 'invalid';
				continue;
			}
			$text = trim( (string) $value );
			if ( mb_strlen( $text ) > 2000 ) {
				$errors[ $key ] = 'too_long';
				continue;
			}
			if ( count( $custom_fields ) >= self::CUSTOM_FIELDS_MAX ) {
				$errors[ $key ] = 'not_allowed';
				continue;
			}
			$custom_fields[ strtolower( $definition_id ) ] = $text;
		}

		if ( array() !== $errors ) {
			return array(
				'ok'     => false,
				'errors' => $errors,
				'body'   => null,
			);
		}

		// Body = ZAMKNIĘTA lista pól kontraktu — nic spoza niej nie wychodzi
		// z formularza do API (obce pola wejścia giną w tym miejscu).
		$body = array(
			'email'          => $email,
			'fullName'       => $full_name,
			'startDate'      => $start_date,
			'endDate'        => $end_date,
			'deliveryMethod' => $delivery_method,
			'paymentMethod'  => $payment_method,
			'items'          => array(
				array(
					'productId' => strtolower( $product_id ),
					'quantity'  => $quantity,
				),
			),
			'termsAccepted'  => true,
			'termsVersion'   => $terms_version,
			'locale'         => in_array( $locale, array( 'pl', 'en' ), true ) ? $locale : 'pl',
		);
		if ( 'pickup' === $delivery_method ) {
			$body['pickupLocationId'] = strtolower( $pickup_location_id );
		}
		if ( '' !== $phone ) {
			$body['phone'] = $phone;
		}
		if ( '' !== $notes ) {
			$body['notes'] = $notes;
		}
		// Mapa idzie tylko wtedy, gdy formularz coś niósł. Pole WYMAGANE,
		// którego klient nie wypełnił, i tak wychwyci serwer — on iteruje po
		// definicjach najemcy, a nie po tym, co przyszło w żądaniu.
		if ( array() !== $custom_fields ) {
			$body['customFields'] = $custom_fields;
		}

		return array(
			'ok'     => true,
			'errors' => array(),
			'body'   => $body,
		);
	}

	/** Pole tekstowe: string, trim, twardy limit długości wejścia. */
	private static function text( array $input, string $key, int $max_input_len ): string {
		if ( ! isset( $input[ $key ] ) || ! is_scalar( $input[ $key ] ) ) {
			return '';
		}
		$value = trim( (string) $input[ $key ] );
		// Limit wejściowy chroni przed absurdalnym payloadem; limity
		// semantyczne (np. notes<=2000) sprawdzane są wyżej per pole.
		return mb_substr( $value, 0, $max_input_len + 1 );
	}

	/** Data ISO z kontrolą kalendarza (2026-02-31 nie przechodzi). */
	public static function is_iso_date( string $value ): bool {
		if ( ! preg_match( Avably_Booking_Api_Client::ISO_DATE_PATTERN, $value ) ) {
			return false;
		}
		$parts = explode( '-', $value );
		return checkdate( (int) $parts[1], (int) $parts[2], (int) $parts[0] );
	}
}
