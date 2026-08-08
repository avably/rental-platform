<?php
/**
 * Sprzątanie przy odinstalowaniu: usuwamy ustawienia (w tym klucz API).
 * Transienty wygasają same; wtyczka nie tworzy żadnych tabel ani nie
 * zapisuje danych osobowych w bazie WordPressa (§5.3 briefu M2).
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

delete_option( 'avably_booking_settings' );
