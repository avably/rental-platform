<?php
/**
 * Renderer widoków wtyczki — katalog, widok produktu z kalendarzem i
 * formularzem rezerwacji.
 *
 * ZASADA (§5.4 briefu M2): KAŻDA wartość z API (nazwy, opisy, adresy)
 * przechodzi przez esc_html()/esc_attr() w miejscu wyjścia. Treść z API
 * jest danymi niezaufanym — produkt o nazwie `<script>…` ma się wyświetlić
 * jako tekst, nie wykonać.
 */

if ( ! defined( 'ABSPATH' ) && ! defined( 'AVABLY_BOOKING_TESTSUITE' ) ) {
	exit;
}

class Avably_Booking_Renderer {

	/** Kwota w groszach => tekst z walutą ("120,00 zł"). */
	public static function format_money( int $grosze, string $currency ): string {
		$symbols = array(
			'PLN' => 'zł',
			'EUR' => '€',
			'USD' => '$',
		);
		$symbol = isset( $symbols[ $currency ] ) ? $symbols[ $currency ] : $currency;
		return number_format( $grosze / 100, 2, ',', ' ' ) . ' ' . $symbol;
	}

	/** Etykieta metody dostawy. */
	public static function delivery_label( string $method ): string {
		switch ( $method ) {
			case 'pickup':
				return __( 'Personal pickup', 'avably-booking' );
			case 'courier':
				return __( 'Courier delivery', 'avably-booking' );
			case 'parcel_locker':
				return __( 'Parcel locker', 'avably-booking' );
			case 'own_delivery':
				return __( 'Store delivery', 'avably-booking' );
			default:
				return $method;
		}
	}

	/** Etykieta metody płatności (tor offline iteracji 1). */
	public static function payment_label( string $method ): string {
		switch ( $method ) {
			case 'transfer':
				return __( 'Bank transfer', 'avably-booking' );
			case 'cod':
				return __( 'Payment on pickup/delivery', 'avably-booking' );
			default:
				return $method;
		}
	}

	/**
	 * Katalog: siatka produktów z linkiem do widoku produktu.
	 *
	 * @param array  $catalog  Odpowiedź /api/v1/catalog (zdekodowana).
	 * @param string $base_url URL strony z shortcodem (do linków produktów).
	 */
	public static function render_catalog( array $catalog, string $base_url ): string {
		$products = isset( $catalog['products'] ) && is_array( $catalog['products'] ) ? $catalog['products'] : array();
		$tenant   = isset( $catalog['tenant'] ) && is_array( $catalog['tenant'] ) ? $catalog['tenant'] : array();
		$currency = isset( $tenant['currency'] ) && is_string( $tenant['currency'] ) ? $tenant['currency'] : 'PLN';

		if ( array() === $products ) {
			return '<div class="avably-booking avably-booking--empty"><p>'
				. esc_html__( 'No products are currently available.', 'avably-booking' )
				. '</p></div>';
		}

		$html = '<div class="avably-booking"><div class="avably-booking__grid">';
		foreach ( $products as $product ) {
			if ( ! is_array( $product ) || ! isset( $product['id'], $product['name'] ) ) {
				continue;
			}
			$product_id = (string) $product['id'];
			if ( ! preg_match( Avably_Booking_Api_Client::UUID_PATTERN, $product_id ) ) {
				continue;
			}
			$name        = (string) $product['name'];
			$description = isset( $product['description'] ) && is_string( $product['description'] ) ? $product['description'] : '';
			$price       = isset( $product['base_price_day_grosze'] ) ? (int) $product['base_price_day_grosze'] : 0;
			$deposit     = isset( $product['deposit_grosze'] ) ? (int) $product['deposit_grosze'] : 0;
			$url         = add_query_arg( 'avably_product', rawurlencode( $product_id ), $base_url );

			$html .= '<article class="avably-booking__card">';
			$html .= '<h3 class="avably-booking__card-title">' . esc_html( $name ) . '</h3>';
			if ( '' !== $description ) {
				$html .= '<p class="avably-booking__card-desc">' . esc_html( self::truncate( $description, 160 ) ) . '</p>';
			}
			$html .= '<p class="avably-booking__card-price"><strong>' . esc_html( self::format_money( $price, $currency ) ) . '</strong> '
				. esc_html__( 'per day', 'avably-booking' ) . '</p>';
			if ( $deposit > 0 ) {
				$html .= '<p class="avably-booking__card-deposit">' . esc_html__( 'Deposit:', 'avably-booking' ) . ' '
					. esc_html( self::format_money( $deposit, $currency ) ) . '</p>';
			}
			$html .= '<p class="avably-booking__card-cta"><a class="avably-booking__button" href="' . esc_url( $url ) . '">'
				. esc_html__( 'Book now', 'avably-booking' ) . '</a></p>';
			$html .= '</article>';
		}
		$html .= '</div></div>';
		return $html;
	}

	/**
	 * Widok produktu: szczegóły + kalendarz (kontener dla JS) + formularz.
	 *
	 * @param array  $product  Wiersz produktu z katalogu.
	 * @param array  $catalog  Cały katalog (metody dostawy, punkty odbioru, waluta).
	 * @param string $back_url URL powrotu do katalogu.
	 */
	public static function render_product( array $product, array $catalog, string $back_url ): string {
		$tenant   = isset( $catalog['tenant'] ) && is_array( $catalog['tenant'] ) ? $catalog['tenant'] : array();
		$currency = isset( $tenant['currency'] ) && is_string( $tenant['currency'] ) ? $tenant['currency'] : 'PLN';

		$product_id  = (string) $product['id'];
		$name        = (string) $product['name'];
		$description = isset( $product['description'] ) && is_string( $product['description'] ) ? $product['description'] : '';
		$price       = isset( $product['base_price_day_grosze'] ) ? (int) $product['base_price_day_grosze'] : 0;
		$deposit     = isset( $product['deposit_grosze'] ) ? (int) $product['deposit_grosze'] : 0;

		$delivery_methods = isset( $catalog['delivery_methods'] ) && is_array( $catalog['delivery_methods'] ) ? $catalog['delivery_methods'] : array();
		$pickup_locations = isset( $catalog['pickup_locations'] ) && is_array( $catalog['pickup_locations'] ) ? $catalog['pickup_locations'] : array();

		$html  = '<div class="avably-booking avably-booking--product" data-avably-product="' . esc_attr( $product_id ) . '">';
		$html .= '<p class="avably-booking__back"><a href="' . esc_url( $back_url ) . '">&larr; '
			. esc_html__( 'Back to catalog', 'avably-booking' ) . '</a></p>';
		$html .= '<h2 class="avably-booking__title">' . esc_html( $name ) . '</h2>';
		if ( '' !== $description ) {
			$html .= '<p class="avably-booking__desc">' . esc_html( $description ) . '</p>';
		}
		$html .= '<p class="avably-booking__price"><strong>' . esc_html( self::format_money( $price, $currency ) ) . '</strong> '
			. esc_html__( 'per day', 'avably-booking' );
		if ( $deposit > 0 ) {
			$html .= ' &middot; ' . esc_html__( 'Deposit:', 'avably-booking' ) . ' ' . esc_html( self::format_money( $deposit, $currency ) );
		}
		$html .= '</p>';

		// Kalendarz — treść dorysowuje JS z endpointu ajaxowego (nigdy z HTML-a
		// strony: strona może stać za cache'em, dostępność nie może).
		$html .= '<div class="avably-booking__calendar" data-avably-calendar>'
			. '<noscript><p>' . esc_html__( 'Enable JavaScript to see the availability calendar.', 'avably-booking' ) . '</p></noscript>'
			. '</div>';

		// Formularz rezerwacji (submit przechwytuje JS => admin-ajax + nonce).
		$html .= '<form class="avably-booking__form" data-avably-form>';
		$html .= '<h3>' . esc_html__( 'Reservation', 'avably-booking' ) . '</h3>';
		$html .= '<div class="avably-booking__notice" data-avably-notice hidden role="alert"></div>';

		$html .= self::field_row(
			'avably-start-date',
			__( 'Start date', 'avably-booking' ),
			'<input type="date" id="avably-start-date" name="start_date" required data-avably-field="startDate">'
		);
		$html .= self::field_row(
			'avably-end-date',
			__( 'End date', 'avably-booking' ),
			'<input type="date" id="avably-end-date" name="end_date" required data-avably-field="endDate">'
		);
		$html .= '<p class="avably-booking__availability" data-avably-availability aria-live="polite"></p>';

		$html .= self::field_row(
			'avably-quantity',
			__( 'Quantity', 'avably-booking' ),
			'<input type="number" id="avably-quantity" name="quantity" value="1" min="1" max="100" required data-avably-field="items">'
		);
		$html .= self::field_row(
			'avably-full-name',
			__( 'Full name', 'avably-booking' ),
			'<input type="text" id="avably-full-name" name="full_name" maxlength="200" required autocomplete="name" data-avably-field="fullName">'
		);
		$html .= self::field_row(
			'avably-email',
			__( 'E-mail address', 'avably-booking' ),
			'<input type="email" id="avably-email" name="email" maxlength="320" required autocomplete="email" data-avably-field="email">'
		);
		$html .= self::field_row(
			'avably-phone',
			__( 'Phone (optional)', 'avably-booking' ),
			'<input type="tel" id="avably-phone" name="phone" maxlength="32" autocomplete="tel" data-avably-field="phone">'
		);

		// Metody dostawy — wyłącznie te, które najemca ma skonfigurowane.
		$delivery_options = '';
		foreach ( $delivery_methods as $method_row ) {
			if ( ! is_array( $method_row ) || ! isset( $method_row['method'] ) ) {
				continue;
			}
			$method = (string) $method_row['method'];
			if ( ! in_array( $method, Avably_Booking_Validator::DELIVERY_METHODS, true ) ) {
				continue;
			}
			$price_grosze      = isset( $method_row['price_grosze'] ) ? (int) $method_row['price_grosze'] : 0;
			$label             = self::delivery_label( $method );
			$label            .= 0 === $price_grosze
				? ' (' . __( 'free', 'avably-booking' ) . ')'
				: ' (' . self::format_money( $price_grosze, $currency ) . ')';
			$delivery_options .= '<option value="' . esc_attr( $method ) . '">' . esc_html( $label ) . '</option>';
		}
		if ( array() !== $pickup_locations && false === strpos( $delivery_options, 'value="pickup"' ) ) {
			// Odbiór osobisty jest dostępny, gdy istnieją punkty odbioru,
			// nawet bez wpisu w cenniku dostaw (odbiór nie ma ceny dostawy).
			$delivery_options = '<option value="pickup">' . esc_html( self::delivery_label( 'pickup' ) . ' (' . __( 'free', 'avably-booking' ) . ')' ) . '</option>' . $delivery_options;
		}
		$html .= self::field_row(
			'avably-delivery',
			__( 'Delivery method', 'avably-booking' ),
			'<select id="avably-delivery" name="delivery_method" required data-avably-field="deliveryMethod">'
				. '<option value="">' . esc_html__( 'Choose…', 'avably-booking' ) . '</option>'
				. $delivery_options
				. '</select>'
		);

		// Punkty odbioru — widoczne tylko przy 'pickup' (steruje JS).
		$location_options = '';
		foreach ( $pickup_locations as $location ) {
			if ( ! is_array( $location ) || ! isset( $location['id'], $location['name'] ) ) {
				continue;
			}
			$location_id = (string) $location['id'];
			if ( ! preg_match( Avably_Booking_Api_Client::UUID_PATTERN, $location_id ) ) {
				continue;
			}
			$label = (string) $location['name'];
			$parts = array();
			foreach ( array( 'address_street', 'address_zip', 'address_city' ) as $part_key ) {
				if ( isset( $location[ $part_key ] ) && is_string( $location[ $part_key ] ) && '' !== $location[ $part_key ] ) {
					$parts[] = $location[ $part_key ];
				}
			}
			if ( array() !== $parts ) {
				$label .= ' — ' . implode( ', ', $parts );
			}
			$location_options .= '<option value="' . esc_attr( $location_id ) . '">' . esc_html( $label ) . '</option>';
		}
		$html .= '<div data-avably-pickup-row hidden>' . self::field_row(
			'avably-pickup-location',
			__( 'Pickup location', 'avably-booking' ),
			'<select id="avably-pickup-location" name="pickup_location_id" data-avably-field="pickupLocationId">'
				. '<option value="">' . esc_html__( 'Choose…', 'avably-booking' ) . '</option>'
				. $location_options
				. '</select>'
		) . '</div>';

		// Płatność: WYŁĄCZNIE tor offline (iteracja 1 M2; online = M4).
		$payment_options = '';
		foreach ( Avably_Booking_Validator::OFFLINE_PAYMENT_METHODS as $method ) {
			$payment_options .= '<option value="' . esc_attr( $method ) . '">' . esc_html( self::payment_label( $method ) ) . '</option>';
		}
		$html .= self::field_row(
			'avably-payment',
			__( 'Payment method', 'avably-booking' ),
			'<select id="avably-payment" name="payment_method" required data-avably-field="paymentMethod">'
				. '<option value="">' . esc_html__( 'Choose…', 'avably-booking' ) . '</option>'
				. $payment_options
				. '</select>'
		);

		// Pola własne najemcy (C6-A3, ADR-121) — definicje przychodzą Z KATALOGU,
		// który wtyczka i tak już pobrała. Osobne żądanie po definicje byłoby
		// drugim wywołaniem API na każde wyświetlenie produktu (patrz bramka
		// amplifikacji w class-avably-booking-ajax.php).
		$html .= self::render_custom_fields( $catalog );

		$html .= self::field_row(
			'avably-notes',
			__( 'Notes (optional)', 'avably-booking' ),
			'<textarea id="avably-notes" name="notes" maxlength="2000" rows="3" data-avably-field="notes"></textarea>'
		);

		$html .= '<p class="avably-booking__terms"><label>'
			. '<input type="checkbox" name="terms_accepted" value="1" required data-avably-field="terms"> '
			. esc_html__( 'I accept the rental terms and conditions.', 'avably-booking' )
			. '</label></p>';

		$html .= '<p><button type="submit" class="avably-booking__button" data-avably-submit>'
			. esc_html__( 'Book now', 'avably-booking' ) . '</button></p>';
		$html .= '</form>';

		// Potwierdzenie — wypełnia JS wyłącznie przez textContent (zero innerHTML
		// dla danych z API).
		$html .= '<div class="avably-booking__confirmation" data-avably-confirmation hidden></div>';
		$html .= '</div>';
		return $html;
	}

	/**
	 * Pola własne do wypełnienia przez klienta (C6-A3, ADR-121).
	 *
	 * API zwraca WYŁĄCZNIE definicje oznaczone „zamawianie" i niezarchiwizowane,
	 * więc wtyczka nie filtruje widoczności — filtruje ENCJĘ: `product` opisuje
	 * sprzęt i wypełnia go operator, a nie kupujący. To samo zawężenie robi
	 * serwer przy zapisie, więc pole podrzucone do formularza ręcznie i tak
	 * odbije się o API.
	 *
	 * Nazwa pola to `cf_<id>` — ten sam klucz, którym API odsyła błędy, więc
	 * `showFieldErrors` w booking.js trafia komunikatem pod właściwe pole bez
	 * żadnej dodatkowej mapy.
	 */
	private static function render_custom_fields( array $catalog ): string {
		$definitions = isset( $catalog['custom_fields'] ) && is_array( $catalog['custom_fields'] )
			? $catalog['custom_fields']
			: array();

		$html = '';
		foreach ( $definitions as $definition ) {
			if ( ! is_array( $definition ) || ! isset( $definition['id'], $definition['field_type'], $definition['label'] ) ) {
				continue;
			}
			$definition_id = (string) $definition['id'];
			if ( ! preg_match( Avably_Booking_Api_Client::UUID_PATTERN, $definition_id ) ) {
				continue;
			}
			$entity = isset( $definition['entity'] ) ? (string) $definition['entity'] : '';
			if ( ! in_array( $entity, array( 'customer', 'order' ), true ) ) {
				continue;
			}

			$type     = (string) $definition['field_type'];
			$label    = (string) $definition['label'];
			$required = ! empty( $definition['required'] );
			$help     = isset( $definition['help_text'] ) && is_string( $definition['help_text'] ) ? $definition['help_text'] : '';
			$name     = 'cf_' . $definition_id;
			$field_id = 'avably-cf-' . $definition_id;

			$attrs = ' id="' . esc_attr( $field_id ) . '" name="' . esc_attr( $name ) . '"'
				. ' data-avably-field="' . esc_attr( $name ) . '"'
				. ( $required ? ' required' : '' );

			switch ( $type ) {
				case 'textarea':
					$control = '<textarea' . $attrs . ' maxlength="2000" rows="3"></textarea>';
					break;
				case 'select':
					$options = '<option value="">' . esc_html__( 'Choose…', 'avably-booking' ) . '</option>';
					$list    = isset( $definition['options'] ) && is_array( $definition['options'] ) ? $definition['options'] : array();
					foreach ( $list as $option ) {
						if ( ! is_scalar( $option ) ) {
							continue;
						}
						$options .= '<option value="' . esc_attr( (string) $option ) . '">' . esc_html( (string) $option ) . '</option>';
					}
					$control = '<select' . $attrs . '>' . $options . '</select>';
					break;
				case 'checkbox':
					// Wartość „1" i BRAK klucza przy niezaznaczonym polu —
					// serwer czyta brak jako `false`, tak samo jak formularz sklepu.
					$control = '<input type="checkbox" value="1"' . $attrs . '>';
					break;
				case 'date':
					$control = '<input type="date"' . $attrs . '>';
					break;
				case 'phone':
					$control = '<input type="tel" maxlength="30"' . $attrs . '>';
					break;
				case 'number':
					// `inputmode` zamiast type="number": polski klient pisze
					// przecinek dziesiętny, którego type="number" odrzuca po cichu.
					$control = '<input type="text" inputmode="decimal"' . $attrs . '>';
					break;
				case 'text':
					$control = '<input type="text" maxlength="200"' . $attrs . '>';
					break;
				default:
					// Typ spoza zamkniętej listy = wtyczka starsza od schematu.
					// Pomijamy pole zamiast zgadywać kontrolkę: zgadnięta kontrolka
					// wysyłałaby wartość, której serwer i tak nie przyjmie.
					continue 2;
			}

			if ( 'checkbox' === $type ) {
				$html .= '<div class="avably-booking__field avably-booking__field--check">'
					. '<label for="' . esc_attr( $field_id ) . '">' . $control . ' ' . esc_html( $label ) . '</label>'
					. ( '' !== $help ? '<span class="avably-booking__field-help">' . esc_html( $help ) . '</span>' : '' )
					. '<span class="avably-booking__field-error" data-avably-error-for="' . esc_attr( $field_id ) . '" hidden></span>'
					. '</div>';
				continue;
			}

			$html .= '<div class="avably-booking__field">'
				. '<label for="' . esc_attr( $field_id ) . '">' . esc_html( $label )
				. ( $required ? '' : ' <span class="avably-booking__field-optional">(' . esc_html__( 'optional', 'avably-booking' ) . ')</span>' )
				. '</label>'
				. $control
				. ( '' !== $help ? '<span class="avably-booking__field-help">' . esc_html( $help ) . '</span>' : '' )
				. '<span class="avably-booking__field-error" data-avably-error-for="' . esc_attr( $field_id ) . '" hidden></span>'
				. '</div>';
		}

		return $html;
	}

	/** Komunikat błędu widoku (np. sklep niedostępny) — bez szczegółów. */
	public static function render_error( string $message ): string {
		return '<div class="avably-booking avably-booking--error"><p>' . esc_html( $message ) . '</p></div>';
	}

	/** Wiersz pola formularza. */
	private static function field_row( string $id, string $label, string $control_html ): string {
		return '<div class="avably-booking__field">'
			. '<label for="' . esc_attr( $id ) . '">' . esc_html( $label ) . '</label>'
			. $control_html
			. '<span class="avably-booking__field-error" data-avably-error-for="' . esc_attr( $id ) . '" hidden></span>'
			. '</div>';
	}

	/** Skrót opisu do listy katalogu. */
	private static function truncate( string $text, int $max ): string {
		if ( mb_strlen( $text ) <= $max ) {
			return $text;
		}
		return rtrim( mb_substr( $text, 0, $max - 1 ) ) . '…';
	}
}
