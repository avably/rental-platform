<?php
/**
 * Bootstrap testów jednostkowych wtyczki — BEZ WordPressa.
 *
 * Testujemy czystą logikę (klient API, kontrakt, walidator, renderer,
 * parsery ajaxowe, sanityzacja ustawień). Funkcje WP używane przez tę
 * logikę dostają minimalne shimy o tej samej semantyce (escaping przez
 * htmlspecialchars — dokładnie to robi esc_html/esc_attr w WP).
 */

define( 'AVABLY_BOOKING_TESTSUITE', true );

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
	return htmlspecialchars( (string) $url, ENT_QUOTES, 'UTF-8' );
}

function add_query_arg( $key, $value, $url ) {
	$separator = str_contains( (string) $url, '?' ) ? '&' : '?';
	return $url . $separator . $key . '=' . $value;
}

/**
 * Testowe ustawienia wtyczki — get_option zwraca zapisany klucz API.
 * Dowód mutacyjny M1 opiera się na tym, że payload frontowy zbudowany
 * przy TAK zapisanym kluczu nie zawiera go.
 */
const AVABLY_TEST_API_KEY = 'avbl_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function get_option( $name, $default = false ) {
	if ( 'avably_booking_settings' === $name ) {
		return array(
			'api_url'    => 'https://api.example.test',
			'api_key'    => AVABLY_TEST_API_KEY,
			'key_prefix' => substr( AVABLY_TEST_API_KEY, 0, 13 ),
		);
	}
	return $default;
}

function apply_filters( $hook, $value ) {
	return $value;
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
