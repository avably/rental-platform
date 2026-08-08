<?php
/**
 * Pomiar R11 (harness porównawczy przed/po naprawie, poza paczką runtime):
 * ile wywołań API kosztuje jedno żądanie month i jak mnożą je żądania
 * współbieżne. Scenariusz współbieżny jest NAJGORSZYM przypadkiem wyścigu:
 * każde żądanie startuje od stanu transientów sprzed pierwszego zapisu,
 * więc nie widzi ani cache'u, ani wpisu-blokady konkurentów.
 */

require __DIR__ . '/../tests/bootstrap.php';

function seed_month_request( string $month, string $product = '2a2a2a2a-1111-4222-8333-444444444444' ): void {
	$_SERVER['REQUEST_METHOD'] = 'GET';
	$_GET                      = array(
		'product_id' => $product,
		'month'      => $month,
		'nonce'      => AvablyTestState::$validNonce,
	);
	$_REQUEST                  = $_GET;
}

$month = date( 'Y-m', strtotime( date( 'Y-m' ) . '-01 +1 months' ) );

// --- Pomiar 1: jedno żądanie month ---
AvablyTestState::reset();
$spy = new AvablySpyApiClient(
	array(
		'ok'         => true,
		'data'       => array( 'available_units' => 2, 'total_units' => 2 ),
		'error_code' => null,
	)
);
AvablyTestState::$apiClient = $spy;
seed_month_request( $month );
try {
	Avably_Booking_Ajax::handle_month();
} catch ( AvablyTestJsonResponse $r ) {
}
$days = (int) date( 't', strtotime( $month . '-01' ) );
echo "Miesiac: {$month} ({$days} dni)\n";
echo "1 zadanie month => {$spy->calls} wywolan API\n";

// --- Pomiar 2: 10 żądań współbieżnych (ten sam miesiąc, wspólny stan
// transientów, żadne nie zdążyło zapisać cache'u — jak w audycie) ---
AvablyTestState::reset();
$spy = new AvablySpyApiClient(
	array(
		'ok'         => true,
		'data'       => array( 'available_units' => 2, 'total_units' => 2 ),
		'error_code' => null,
	)
);
AvablyTestState::$apiClient = $spy;
$snapshot = null;
for ( $i = 0; $i < 10; $i++ ) {
	// Współbieżność: każde żądanie startuje od stanu transientów z chwili
	// startu pierwszego (żaden zapis cache'u „w locie" nie jest widoczny).
	if ( null === $snapshot ) {
		$snapshot = AvablyTestState::$transients;
	}
	AvablyTestState::$transients = $snapshot;
	seed_month_request( $month );
	try {
		Avably_Booking_Ajax::handle_month();
	} catch ( AvablyTestJsonResponse $r ) {
	}
}
echo "10 wspolbieznych zadan month => {$spy->calls} wywolan API\n";

// --- Pomiar 3: worker PHP — najgorszy czas trzymania przy wolnym API ---
// Budżet czasu tnie pętlę: ostatnie wywołanie może ruszyć tuż przed
// deadline'em i trwać pełny timeout odczytu.
$worst = Avably_Booking_Ajax::MONTH_TIME_BUDGET + Avably_Booking_Api_Client::TIMEOUT_READ;
echo 'timeout odczytu: ' . Avably_Booking_Api_Client::TIMEOUT_READ
	. ' s; budzet czasu zadania month: ' . Avably_Booking_Ajax::MONTH_TIME_BUDGET
	. " s => najgorszy przypadek trzymania workera: ~{$worst} s\n";
