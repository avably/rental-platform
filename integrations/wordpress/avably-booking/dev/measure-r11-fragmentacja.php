<?php
/**
 * POMIAR (R11, delta recenzji PM #218): ile wywołań API kosztuje rozstrzygnięcie
 * miesiąca przy KAŻDYM układzie rezerwacji — nie przy jednym wybranym.
 *
 * Liczby z tego przebiegu są podstawą decyzji 2a w ADR-114 (dobór zapasu sond
 * MONTH_SPLIT_SLACK). Uruchomienie z katalogu wtyczki:
 *   docker run --rm -v "$(pwd)":/app -w /app php:8.1-cli php dev/measure-r11-fragmentacja.php
 *
 * Model klienta jest ZACHOWAWCZY wobec algorytmu: produkt w 1 egzemplarzu,
 * zakres zwraca 0, jeśli obejmuje choć jeden zajęty dzień (najgorszy przypadek
 * dla podziałów — każdy zajęty dzień zeruje cały zakres, w którym leży).
 */

require __DIR__ . '/../tests/bootstrap.php';

final class MiaraKlient extends Avably_Booking_Api_Client {
	public int $calls = 0;
	/** @var array<int,bool> Zajęte dni miesiąca (numer dnia => true). */
	private array $zajete;

	public function __construct( array $zajete ) {
		parent::__construct(
			'https://api.example.test',
			AVABLY_TEST_API_KEY,
			static fn(): array => array( 'code' => 200, 'body' => '{}' )
		);
		$this->zajete = array_fill_keys( $zajete, true );
	}

	public function get_availability( string $product_id, string $start_date, string $end_date ): array {
		$this->calls++;
		$from = (int) substr( $start_date, 8, 2 );
		$to   = (int) substr( $end_date, 8, 2 );
		for ( $i = $from; $i <= $to; $i++ ) {
			if ( isset( $this->zajete[ $i ] ) ) {
				return array( 'ok' => true, 'data' => array( 'available_units' => 0, 'total_units' => 1 ), 'error_code' => null );
			}
		}
		return array( 'ok' => true, 'data' => array( 'available_units' => 1, 'total_units' => 1 ), 'error_code' => null );
	}
}

/** @return array{calls:int,klamstwa:int,nieznane:int} */
function zmierz( array $dni_iso, array $zajete ): array {
	$client = new MiaraKlient( $zajete );
	$wynik  = Avably_Booking_Ajax::resolve_month_days(
		$client,
		'2a2a2a2a-1111-4222-8333-444444444444',
		$dni_iso,
		Avably_Booking_Ajax::month_call_ceiling( count( $dni_iso ) ),
		PHP_FLOAT_MAX
	);
	$klamstwa = 0;
	foreach ( $wynik['days'] as $iso => $units ) {
		$nr = (int) substr( $iso, 8, 2 );
		if ( 0 === $units && ! in_array( $nr, $zajete, true ) ) {
			$klamstwa++;
		}
		if ( $units > 0 && in_array( $nr, $zajete, true ) ) {
			$klamstwa++; // Dzień zajęty pokazany jako wolny — jeszcze gorzej.
		}
	}
	return array(
		'calls'    => $client->calls,
		'klamstwa' => $klamstwa,
		'nieznane' => count( $wynik['unresolved'] ),
	);
}

/** Wszystkie k-elementowe podzbiory zbioru 1..n (k <= 3). */
function uklady( int $n, int $k ): array {
	if ( 0 === $k ) {
		return array( array() );
	}
	$out = array();
	if ( 1 === $k ) {
		for ( $a = 1; $a <= $n; $a++ ) {
			$out[] = array( $a );
		}
		return $out;
	}
	if ( 2 === $k ) {
		for ( $a = 1; $a <= $n; $a++ ) {
			for ( $b = $a + 1; $b <= $n; $b++ ) {
				$out[] = array( $a, $b );
			}
		}
		return $out;
	}
	for ( $a = 1; $a <= $n; $a++ ) {
		for ( $b = $a + 1; $b <= $n; $b++ ) {
			for ( $c = $b + 1; $c <= $n; $c++ ) {
				$out[] = array( $a, $b, $c );
			}
		}
	}
	return $out;
}

$miesiac  = '2027-01';                    // 31 dni — najgorszy rozmiar.
$dni      = Avably_Booking_Ajax::month_days( $miesiac, '2026-01-01' );
$n        = count( $dni );
$sufit    = Avably_Booking_Ajax::month_call_ceiling( $n );

echo "Miesiac {$miesiac}: {$n} dni, 1 sztuka\n";
echo 'zapas sond MONTH_SPLIT_SLACK = ' . Avably_Booking_Ajax::MONTH_SPLIT_SLACK . ", sufit = {$sufit}\n";
echo "linia bazowa sprzed naprawy (jedno wywolanie na dzien) = {$n}\n\n";

$klamstwa_razem = 0;
$nieznane_razem = 0;

foreach ( array( 0, 1, 2, 3 ) as $k ) {
	$max   = 0;
	$suma  = 0;
	$ile   = 0;
	$worst = array();
	foreach ( uklady( $n, $k ) as $uklad ) {
		$m               = zmierz( $dni, $uklad );
		$klamstwa_razem += $m['klamstwa'];
		$nieznane_razem += $m['nieznane'];
		$suma           += $m['calls'];
		$ile++;
		if ( $m['calls'] > $max ) {
			$max   = $m['calls'];
			$worst = $uklad;
		}
	}
	printf(
		"rezerwacji=%d  ukladow=%-5d  wywolan: max=%-3d sr=%-5.1f  najgorszy uklad=[%s]\n",
		$k,
		$ile,
		$max,
		$suma / $ile,
		implode( ',', $worst )
	);
}

// Układy gęste — tam, gdzie podziały binarne przegrywają z pytaniem per dzień.
$gęste = array(
	'weekendy'          => array( 3, 4, 10, 11, 17, 18, 24, 25, 31 ),
	'co drugi dzien'    => range( 1, 31, 2 ),
	'caly miesiac'      => range( 1, 31 ),
	'pierwsza polowa'   => range( 1, 16 ),
	'skrajne dni'       => array( 1, 31 ),
);
echo "\n";
foreach ( $gęste as $nazwa => $uklad ) {
	$m               = zmierz( $dni, $uklad );
	$klamstwa_razem += $m['klamstwa'];
	$nieznane_razem += $m['nieznane'];
	printf( "%-18s zajetych=%-2d wywolan=%d\n", $nazwa, count( $uklad ), $m['calls'] );
}

printf( "\nDNI POKAZANE NIEPRAWDZIWIE (suma po WSZYSTKICH ukladach): %d\n", $klamstwa_razem );
printf( "DNI NIEROZSTRZYGNIETE przy zdrowym API: %d\n", $nieznane_razem );
