<?php
/**
 * Ustawienia wtyczki (wp-admin => Ustawienia => Avably Booking).
 *
 * Klucz API żyje WYŁĄCZNIE server-side w wp_options (autoload wyłączony)
 * i NIGDY nie wraca do HTML-a: pole klucza jest zawsze puste (type=password,
 * bez value), a zapisany stan pokazujemy wyłącznie prefiksem identyfikacyjnym
 * `avbl_XXXXXXXX…` (ten sam prefiks, który widać w panelu Avably — nie jest
 * sekretem). Podmiana klucza = wpisanie nowego; puste pole = bez zmian.
 */

if ( ! defined( 'ABSPATH' ) && ! defined( 'AVABLY_BOOKING_TESTSUITE' ) ) {
	exit;
}

class Avably_Booking_Settings {

	public const OPTION_NAME = 'avably_booking_settings';

	/** Domyślny bazowy URL API — produkcyjna platforma Avably. */
	public const DEFAULT_API_URL = 'https://www.avably.io';

	/** Długość prefiksu identyfikacyjnego klucza (avbl_ + 8 hex, jak w panelu). */
	public const KEY_PREFIX_LENGTH = 13;

	public static function register(): void {
		add_action( 'admin_menu', array( __CLASS__, 'add_menu' ) );
		add_action( 'admin_init', array( __CLASS__, 'register_settings' ) );
	}

	/** Bieżące ustawienia z bezpiecznymi domyślnymi. */
	public static function get(): array {
		$stored = get_option( self::OPTION_NAME, array() );
		if ( ! is_array( $stored ) ) {
			$stored = array();
		}
		return array(
			'api_url'    => isset( $stored['api_url'] ) && is_string( $stored['api_url'] ) && '' !== $stored['api_url']
				? $stored['api_url']
				: self::DEFAULT_API_URL,
			'api_key'    => isset( $stored['api_key'] ) && is_string( $stored['api_key'] ) ? $stored['api_key'] : '',
			'key_prefix' => isset( $stored['key_prefix'] ) && is_string( $stored['key_prefix'] ) ? $stored['key_prefix'] : '',
		);
	}

	public static function add_menu(): void {
		add_options_page(
			__( 'Avably Booking', 'avably-booking' ),
			__( 'Avably Booking', 'avably-booking' ),
			'manage_options',
			'avably-booking',
			array( __CLASS__, 'render_page' )
		);
	}

	public static function register_settings(): void {
		register_setting(
			'avably_booking',
			self::OPTION_NAME,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( __CLASS__, 'sanitize' ),
				// Autoload wyłączony: sekret nie jeździ z każdym żądaniem
				// w pamięci opcji autoloadowanych.
				'autoload'          => false,
			)
		);
	}

	/**
	 * Sanityzacja zapisu: URL musi być http(s); klucz — pusty zachowuje
	 * dotychczasowy, niepusty musi mieć format kontraktu (avbl_ + 64 hex).
	 *
	 * Czysta logika w sanitize_input() (testowalna bez WP).
	 */
	public static function sanitize( $raw ): array {
		$current = self::get();
		$result  = self::sanitize_input( is_array( $raw ) ? $raw : array(), $current );

		if ( null !== $result['error'] && function_exists( 'add_settings_error' ) ) {
			add_settings_error( self::OPTION_NAME, 'avably_booking_invalid', $result['error'] );
		}
		return $result['settings'];
	}

	/**
	 * Rdzeń sanityzacji — bez funkcji WP.
	 *
	 * @param array $raw     Surowe wejście formularza.
	 * @param array $current Dotychczasowe ustawienia.
	 * @return array{settings:array, error:?string}
	 */
	public static function sanitize_input( array $raw, array $current ): array {
		$error = null;

		$api_url = isset( $raw['api_url'] ) && is_scalar( $raw['api_url'] ) ? trim( (string) $raw['api_url'] ) : '';
		$api_url = rtrim( $api_url, '/' );
		if ( '' === $api_url ) {
			$api_url = self::DEFAULT_API_URL;
		} elseif ( ! preg_match( '#^https?://[^\s]+$#i', $api_url ) ) {
			$error   = __( 'API URL must start with http:// or https://.', 'avably-booking' );
			$api_url = $current['api_url'];
		}

		$api_key    = $current['api_key'];
		$key_prefix = $current['key_prefix'];
		$raw_key    = isset( $raw['api_key'] ) && is_scalar( $raw['api_key'] ) ? trim( (string) $raw['api_key'] ) : '';
		if ( '' !== $raw_key ) {
			if ( preg_match( Avably_Booking_Api_Client::API_KEY_PATTERN, $raw_key ) ) {
				$api_key    = $raw_key;
				$key_prefix = substr( $raw_key, 0, self::KEY_PREFIX_LENGTH );
			} else {
				$error = __( 'The API key has an invalid format. Copy the full key from the Avably panel (avbl_…).', 'avably-booking' );
			}
		}

		return array(
			'settings' => array(
				'api_url'    => $api_url,
				'api_key'    => $api_key,
				'key_prefix' => $key_prefix,
			),
			'error'    => $error,
		);
	}

	public static function render_page(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$settings   = self::get();
		$has_key    = '' !== $settings['api_key'];
		$key_status = $has_key
			/* translators: %s: masked API key prefix. */
			? sprintf( __( 'Key saved: %s…', 'avably-booking' ), $settings['key_prefix'] )
			: __( 'No API key saved yet.', 'avably-booking' );
		?>
		<div class="wrap">
			<h1><?php echo esc_html__( 'Avably Booking', 'avably-booking' ); ?></h1>
			<p><?php echo esc_html__( 'Connect your WordPress site to your Avably rental store. Generate an API key in the Avably panel (Organization → API settings).', 'avably-booking' ); ?></p>
			<form method="post" action="options.php">
				<?php settings_fields( 'avably_booking' ); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row">
							<label for="avably-api-url"><?php echo esc_html__( 'API URL', 'avably-booking' ); ?></label>
						</th>
						<td>
							<input name="<?php echo esc_attr( self::OPTION_NAME ); ?>[api_url]" id="avably-api-url"
								type="url" class="regular-text code"
								value="<?php echo esc_attr( $settings['api_url'] ); ?>">
							<p class="description"><?php echo esc_html__( 'Leave the default unless Avably support tells you otherwise.', 'avably-booking' ); ?></p>
						</td>
					</tr>
					<tr>
						<th scope="row">
							<label for="avably-api-key"><?php echo esc_html__( 'API key', 'avably-booking' ); ?></label>
						</th>
						<td>
							<?php // Celowo BEZ value: zapisany klucz nigdy nie wraca do HTML-a. ?>
							<input name="<?php echo esc_attr( self::OPTION_NAME ); ?>[api_key]" id="avably-api-key"
								type="password" class="regular-text code" autocomplete="off"
								placeholder="avbl_…">
							<p class="description"><?php echo esc_html( $key_status ); ?></p>
							<p class="description"><?php echo esc_html__( 'Paste a new key to replace the saved one. Leave empty to keep it.', 'avably-booking' ); ?></p>
						</td>
					</tr>
				</table>
				<?php submit_button(); ?>
			</form>
			<hr>
			<h2><?php echo esc_html__( 'Usage', 'avably-booking' ); ?></h2>
			<p><?php echo esc_html__( 'Add the [avably_booking] shortcode or the “Avably Booking” block to any page to embed the booking flow.', 'avably-booking' ); ?></p>
		</div>
		<?php
	}
}
