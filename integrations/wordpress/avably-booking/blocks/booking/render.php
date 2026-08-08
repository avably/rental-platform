<?php
/**
 * Render bloku avably/booking — CIENKA owijka shortcode'u (ADR-110):
 * jedna ścieżka renderowania dla obu wejść.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

echo Avably_Booking_Plugin::render_shortcode(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- HTML budowany w rendererze z escapingiem per wartość.
