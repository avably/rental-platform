<?php
/**
 * Plugin Name:       Avably Booking
 * Plugin URI:        https://www.avably.io
 * Description:       Rezerwacje online dla wypożyczalni — katalog, kalendarz dostępności i formularz rezerwacji wpięte w Twoją stronę WordPress (shortcode i blok Gutenberga).
 * Version:           0.1.0
 * Requires at least: 6.5
 * Requires PHP:      8.1
 * Author:            Avably
 * Author URI:        https://www.avably.io
 * License:           GPLv2 or later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       avably-booking
 * Domain Path:       /languages
 */

// Bez bezpośredniego wykonania: plik działa wyłącznie w środowisku WordPressa.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'AVABLY_BOOKING_VERSION', '0.1.0' );
define( 'AVABLY_BOOKING_PLUGIN_FILE', __FILE__ );
define( 'AVABLY_BOOKING_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'AVABLY_BOOKING_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

require_once AVABLY_BOOKING_PLUGIN_DIR . 'includes/class-avably-booking-contract.php';
require_once AVABLY_BOOKING_PLUGIN_DIR . 'includes/class-avably-booking-api-client.php';
require_once AVABLY_BOOKING_PLUGIN_DIR . 'includes/class-avably-booking-validator.php';
require_once AVABLY_BOOKING_PLUGIN_DIR . 'includes/class-avably-booking-renderer.php';
require_once AVABLY_BOOKING_PLUGIN_DIR . 'includes/class-avably-booking-settings.php';
require_once AVABLY_BOOKING_PLUGIN_DIR . 'includes/class-avably-booking-ajax.php';
require_once AVABLY_BOOKING_PLUGIN_DIR . 'includes/class-avably-booking-plugin.php';

Avably_Booking_Plugin::boot();
