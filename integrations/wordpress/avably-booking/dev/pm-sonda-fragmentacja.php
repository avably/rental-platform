<?php
/**
 * SONDA PM (recenzja #218) — wektor INNY niż dowody wykonawcy.
 * Pytanie: co dostaje odwiedzający, gdy dostępność jest POFRAGMENTOWANA
 * (typowy sklep: produkt w 1 egzemplarzu, kilka rezerwacji w miesiącu)?
 * Mierzę: liczbę wywołań API, flagę complete, TTL cache'u i liczbę dni
 * FAŁSZYWIE pokazanych jako zajęte.
 */

require __DIR__ . '/../tests/bootstrap.php';

/** Klient modelujący prawdziwy kalendarz: 1 sztuka, rezerwacje w podanych dniach. */
class PmKalendarzClient extends Avably_Booking_Api_Client {
	public int $calls = 0;
	/** @var int[] dni miesiąca (1..31) zajęte */
	private array $zajete;
	private int $units;

	public function __construct( array $zajete, int $units = 1 ) {
		parent::__construct( 'https://api.example.test', AVABLY_TEST_API_KEY, static fn() => array( 'code' => 200, 'body' => '{}' ) );
		$this->zajete = $zajete;
		$this->units  = $units;
	}

	/** Sztuk wolnych przez CAŁY zakres: 0, jeśli którykolwiek dzień zakresu zajęty. */
	public function get_availability( string $product_id, string $start_date, string $end_date ): array {
		$this->calls++;
		$d   = (int) substr( $start_date, 8, 2 );
		$end = (int) substr( $end_date, 8, 2 );
		for ( $i = $d; $i <= $end; $i++ ) {
			if ( in_array( $i, $this->zajete, true ) ) {
				return array( 'ok' => true, 'data' => array( 'available_units' => 0, 'total_units' => $this->units ), 'error_code' => null );
			}
		}
		return array( 'ok' => true, 'data' => array( 'available_units' => $this->units, 'total_units' => $this->units ), 'error_code' => null );
	}
}

function pm_scenariusz( string $nazwa, array $zajete ): void {
	$month = date( 'Y-m', strtotime( date( 'Y-m' ) . '-01 +1 months' ) );
	AvablyTestState::reset();
	$client                     = new PmKalendarzClient( $zajete );
	AvablyTestState::$apiClient = $client;

	$_SERVER['REQUEST_METHOD'] = 'GET';
	$_GET                      = array(
		'product_id' => '2a2a2a2a-1111-4222-8333-444444444444',
		'month'      => $month,
		'nonce'      => AvablyTestState::$validNonce,
	);
	$_REQUEST = $_GET;

	$payload = null;
	try {
		Avably_Booking_Ajax::handle_month();
	} catch ( AvablyTestJsonResponse $r ) {
		$payload = $r->payload;
	}

	$dni_w_miesiacu = (int) date( 't', strtotime( $month . '-01' ) );
	$falszywe       = array();
	foreach ( $payload['days'] as $iso => $units ) {
		$nr = (int) substr( $iso, 8, 2 );
		if ( 0 === $units && ! in_array( $nr, $zajete, true ) ) {
			$falszywe[] = $nr;
		}
	}
	$nieznane = array();
	foreach ( ( $payload['unresolved'] ?? array() ) as $iso ) {
		$nieznane[] = (int) substr( $iso, 8, 2 );
	}
	$ttl = 0;
	foreach ( AvablyTestState::$transientTtls as $k => $v ) {
		if ( str_starts_with( $k, 'avably_bk_m_' ) ) {
			$ttl = $v;
		}
	}

	printf(
		"%-38s zajete=%-2d wywolan=%-3d TTL=%-4d dni_falszywie_zajete=%-2d dni_nierozstrzygniete=%d%s\n",
		$nazwa,
		count( $zajete ),
		$client->calls,
		$ttl,
		count( $falszywe ),
		count( $nieznane ),
		$falszywe ? ' -> ' . implode( ',', $falszywe ) : ''
	);
}

echo "Miesiac testowy: " . date( 'Y-m', strtotime( date( 'Y-m' ) . '-01 +1 months' ) )
	. ' (' . (int) date( 't', strtotime( date( 'Y-m', strtotime( date( 'Y-m' ) . '-01 +1 months' ) ) . '-01' ) ) . " dni), 1 sztuka\n";
echo 'SUFIT wywolan = ' . Avably_Booking_Ajax::month_call_ceiling(
	(int) date( 't', strtotime( date( 'Y-m', strtotime( date( 'Y-m' ) . '-01 +1 months' ) ) . '-01' ) )
) . ' (zapas sond = ' . Avably_Booking_Ajax::MONTH_SPLIT_SLACK . ")\n\n";

pm_scenariusz( 'A: brak rezerwacji', array() );
pm_scenariusz( 'B: 1 rezerwacja (15)', array( 15 ) );
pm_scenariusz( 'C: 2 rezerwacje (8, 22)', array( 8, 22 ) );
pm_scenariusz( 'D: 3 rezerwacje (5, 14, 25)', array( 5, 14, 25 ) );
pm_scenariusz( 'E: weekendy zajete', array( 2, 3, 9, 10, 16, 17, 23, 24, 30 ) );
pm_scenariusz( 'F: co drugi dzien zajety', range( 1, 31, 2 ) );
