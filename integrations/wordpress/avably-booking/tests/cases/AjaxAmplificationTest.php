<?php
/**
 * R11 — amplifikacja żądań i zajeżdżanie workerów PHP (audyt 2026-08-08).
 *
 * Stan sprzed naprawy, POTWIERDZONY POMIAREM na tym harnessie
 * (dev/measure-r11.php, liczby mierzymy — nie deklarujemy): jedno żądanie
 * `month` wołało API per dzień miesiąca (30 wywołań dla miesiąca
 * 30-dniowego), 10 żądań współbieżnych — 300 wywołań, bo cache lądował
 * DOPIERO PO pętli, a dławienie istniało wyłącznie na `reserve`.
 *
 * MIARĄ KAŻDEJ BRAMKI JEST LICZNIK WYWOŁAŃ KLIENTA API (wzorzec
 * AjaxNonceGateTest) — nie kod odpowiedzi. Kody odpowiedzi kłamią, licznik
 * nie: chronimy budżet API najemcy i workerów PHP, nie kształt JSON-a.
 */

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Atrapa klienta API z licznikiem wywołań i PROGRAMOWALNĄ odpowiedzią per
 * zakres dat — bramki R11 potrzebują scenariuszy „ten zakres wolny, tamten
 * zajęty", których stała odpowiedź AvablySpyApiClient nie wyrazi.
 */
final class AvablyScriptedRangeClient extends Avably_Booking_Api_Client {

	public int $calls = 0;

	/** @var array<int,array{0:string,1:string}> Zapytane zakresy [start, end]. */
	public array $ranges = array();

	/** @var callable(string,string,int):mixed int => available_units; array => gotowy wynik klienta. */
	private $responder;

	public function __construct( callable $responder ) {
		parent::__construct(
			'https://api.example.test',
			AVABLY_TEST_API_KEY,
			static fn (): array => array(
				'code' => 200,
				'body' => '{}',
			)
		);
		$this->responder = $responder;
	}

	public function get_availability( string $product_id, string $start_date, string $end_date ): array {
		$this->calls++;
		$this->ranges[] = array( $start_date, $end_date );
		$result         = call_user_func( $this->responder, $start_date, $end_date, $this->calls );
		if ( is_array( $result ) ) {
			return $result;
		}
		return array(
			'ok'         => true,
			'data'       => array(
				'available_units' => (int) $result,
				'total_units'     => 5,
			),
			'error_code' => null,
		);
	}
}

/**
 * Klient modelujący PRAWDZIWY kalendarz małego najemcy: produkt w JEDNYM
 * egzemplarzu, kilka rezerwacji w miesiącu. Zakres zwraca 0, jeśli obejmuje
 * choć jeden zajęty dzień — dokładnie tak zachowuje się `GET /availability`
 * (liczba sztuk wolnych przez CAŁY zakres).
 *
 * To wcielona sonda recenzji PM #218: na tym modelu budżet 12 wywołań oddawał
 * czternaście WOLNYCH dni jako zajęte przy dwóch rezerwacjach w miesiącu.
 */
final class AvablySingleUnitCalendarClient extends Avably_Booking_Api_Client {

	public int $calls = 0;

	/** @var array<int,bool> Numery dni miesiąca, które są zajęte. */
	private array $taken;

	public function __construct( array $taken_days ) {
		parent::__construct(
			'https://api.example.test',
			AVABLY_TEST_API_KEY,
			static fn (): array => array(
				'code' => 200,
				'body' => '{}',
			)
		);
		$this->taken = array_fill_keys( $taken_days, true );
	}

	public function get_availability( string $product_id, string $start_date, string $end_date ): array {
		$this->calls++;
		$from = (int) substr( $start_date, 8, 2 );
		$to   = (int) substr( $end_date, 8, 2 );
		for ( $day = $from; $day <= $to; $day++ ) {
			if ( isset( $this->taken[ $day ] ) ) {
				return array(
					'ok'         => true,
					'data'       => array(
						'available_units' => 0,
						'total_units'     => 1,
					),
					'error_code' => null,
				);
			}
		}
		return array(
			'ok'         => true,
			'data'       => array(
				'available_units' => 1,
				'total_units'     => 1,
			),
			'error_code' => null,
		);
	}
}

/**
 * Wtyczka z PODSTAWIONYM zegarem — jedyne miejsce, w którym ścieżka month pyta
 * o czas, to `Avably_Booking_Ajax::now()`, wołane przez `static::`. Dzięki temu
 * scenariusz WOLNEGO API przechodzi przez PRODUKCYJNE ciało `handle_month`
 * (cache, blokada, wybór TTL, kształt payloadu), a nie przez jego kopię
 * w teście — i nie kosztuje dziesięciu sekund czekania.
 */
final class AvablySlowClockAjax extends Avably_Booking_Ajax {

	public static float $now  = 0.0;
	public static float $step = 0.0;

	public static function now(): float {
		$value      = self::$now;
		self::$now += self::$step;
		return $value;
	}
}

final class AjaxAmplificationTest extends TestCase {

	private const PRODUCT = '2a2a2a2a-1111-4222-8333-444444444444';

	protected function setUp(): void {
		AvablyTestState::reset();
	}

	/** Pełny przyszły miesiąc (stała liczba dni, bez odcinania przeszłości). */
	private function futureMonth( int $offset = 1 ): string {
		return date( 'Y-m', strtotime( date( 'Y-m' ) . '-01 +' . $offset . ' months' ) );
	}

	private function seedMonthRequest( string $month, string $product = self::PRODUCT ): void {
		$_SERVER['REQUEST_METHOD'] = 'GET';
		$_GET                      = array(
			'product_id' => $product,
			'month'      => $month,
			'nonce'      => AvablyTestState::$validNonce,
		);
		$_REQUEST                  = $_GET;
	}

	private function seedAvailabilityRequest(): void {
		$_SERVER['REQUEST_METHOD'] = 'GET';
		$_GET                      = array(
			'product_id' => self::PRODUCT,
			'start_date' => '2027-03-01',
			'end_date'   => '2027-03-03',
			'nonce'      => AvablyTestState::$validNonce,
		);
		$_REQUEST                  = $_GET;
	}

	/** @return AvablyTestJsonResponse Zakończenie żądania month. */
	private function runMonth(): AvablyTestJsonResponse {
		try {
			Avably_Booking_Ajax::handle_month();
		} catch ( AvablyTestJsonResponse $response ) {
			return $response;
		}
		$this->fail( 'handle_month nie zakończył żądania odpowiedzią JSON' );
	}

	// ------------------------------------------------------------------
	// Bramka 1: licznik wywołań na jedno żądanie month.
	// ------------------------------------------------------------------

	/**
	 * Miesiąc w pełni dostępny (przypadek dominujący): JEDNO wywołanie API
	 * zamiast pętli per dzień. Dostępność zakresu = liczba sztuk wolnych przez
	 * CAŁY zakres, więc wynik > 0 jest dolnym ograniczeniem każdego dnia —
	 * wystarcza siatce kalendarza, która rozstrzyga po `> 0`.
	 */
	public function test_open_month_resolves_in_single_api_call(): void {
		$client                     = new AvablyScriptedRangeClient( static fn (): int => 3 );
		AvablyTestState::$apiClient = $client;
		$month                      = $this->futureMonth();
		$this->seedMonthRequest( $month );

		$response = $this->runMonth();

		$this->assertTrue( $response->success );
		$this->assertSame( 1, $client->calls, 'Otwarty miesiąc ma kosztować DOKŁADNIE jedno wywołanie API' );

		$days_in_month = (int) date( 't', strtotime( $month . '-01' ) );
		$this->assertCount( $days_in_month, $response->payload['days'] );
		$this->assertSame( array( 3 ), array_values( array_unique( $response->payload['days'] ) ) );

		// Payload frontowy bez śladu sekretu (bramka izolacji R11).
		$this->assertStringNotContainsString( 'avbl_', (string) json_encode( $response->payload ) );
	}

	/**
	 * Sufit wywołań API na żądanie month — test pilnuje POLITYKI (ADR-114,
	 * decyzja 2a), nie zaklepanej liczby.
	 *
	 * Poprzednia wersja przypinała `MONTH_API_CALL_BUDGET <= 12` i przez to
	 * BRONIŁA BŁĘDU: budżet 12 nie wystarczał na rozstrzygnięcie miesiąca
	 * z dwiema rezerwacjami, a niedopytane dni szły do odwiedzającego jako
	 * zajęte. Polityka, której pilnujemy teraz, ma cztery punkty:
	 *   1. sufit ISTNIEJE i jest WYPROWADZONY z liczby dni (nie magiczna stała),
	 *   2. nigdy nie schodzi poniżej liczby dni — sufit, pod którym miesiąca nie
	 *      da się domknąć, kupuje oszczędność kłamstwem,
	 *   3. nie rośnie w nieskończoność (gołe podziały binarne kosztują ~2n),
	 *   4. najgorszy przypadek MIEŚCI SIĘ pod nim i jest KOMPLETNY — mierzone,
	 *      nie deklarowane.
	 */
	public function test_month_api_calls_have_hard_ceiling(): void {
		foreach ( array( 28, 29, 30, 31 ) as $day_count ) {
			$ceiling = Avably_Booking_Ajax::month_call_ceiling( $day_count );
			$this->assertSame(
				$day_count + Avably_Booking_Ajax::MONTH_SPLIT_SLACK,
				$ceiling,
				'Sufit przestał być wyprowadzany z liczby dni'
			);
			$this->assertGreaterThanOrEqual( $day_count, $ceiling, 'Sufit poniżej liczby dni — miesiąca nie da się domknąć' );
			$this->assertLessThan( 2 * $day_count, $ceiling, 'Sufit rośnie w stronę kosztu gołych podziałów (~2n)' );
		}
		$this->assertSame( 0, Avably_Booking_Ajax::month_call_ceiling( 0 ) );

		// Polityka ma być ZAPISANA, nie tylko zaimplementowana. Sprawdzamy
		// README wtyczki, bo tylko ono jest w zasięgu obu przebiegów suity
		// (lokalny kontener montuje SAM katalog wtyczki, CI — całe repo);
		// pełne uzasadnienie liczb siedzi w ADR-114, do którego README kieruje.
		$readme = (string) file_get_contents( dirname( __DIR__, 2 ) . '/README.md' );
		$this->assertStringContainsString( 'MONTH_SPLIT_SLACK', $readme, 'Polityka sufitu wywołań nieopisana w README wtyczki' );
		$this->assertStringContainsString( 'ADR-114', $readme );

		// Najgorszy przypadek: miesiąc w CAŁOŚCI zajęty (maksymalna liczba
		// podziałów). Ma zmieścić się pod sufitem i rozstrzygnąć KAŻDY dzień.
		$client                     = new AvablyScriptedRangeClient( static fn (): int => 0 );
		AvablyTestState::$apiClient = $client;
		$month                      = $this->futureMonth();
		$this->seedMonthRequest( $month );

		$response      = $this->runMonth();
		$days_in_month = (int) date( 't', strtotime( $month . '-01' ) );

		$this->assertTrue( $response->success );
		$this->assertGreaterThan( 0, $client->calls );
		$this->assertLessThanOrEqual(
			Avably_Booking_Ajax::month_call_ceiling( $days_in_month ),
			$client->calls,
			'Rozstrzyganie przebiło własny sufit'
		);
		$this->assertSame( array(), $response->payload['unresolved'], 'Miesiąc nie domknął się pod sufitem' );
		$this->assertFalse( $response->payload['partial'] );
		$this->assertCount( $days_in_month, $response->payload['days'] );
	}

	/**
	 * BRAMKA NADRZĘDNA (delta recenzji PM #218): żaden WOLNY dzień nie ma prawa
	 * dotrzeć do odwiedzającego jako zajęty — przy dowolnym rozkładzie
	 * rezerwacji, także wtedy, gdy rozstrzygnięcie kosztuje więcej wywołań.
	 *
	 * Scenariusze to wcielona sonda PM. Na HEAD-zie sprzed tej poprawki
	 * (budżet 12 wywołań, dni niedopytane oddawane jako zachowawcze `0`)
	 * wariant „2 rezerwacje" oddawał 14 wolnych dni jako zajęte, „3 rezerwacje"
	 * 16, weekendy 15, co drugi dzień 13. Utrata rezerwacji jest CICHA: klient
	 * po prostu nie rezerwuje i nikt tego nie zgłasza.
	 *
	 * @param int[] $taken Numery zajętych dni miesiąca.
	 */
	#[DataProvider( 'fragmentationScenarios' )]
	public function test_fragmented_month_never_reports_a_free_day_as_taken( array $taken ): void {
		$client                     = new AvablySingleUnitCalendarClient( $taken );
		AvablyTestState::$apiClient = $client;
		$month                      = $this->futureMonth();
		$this->seedMonthRequest( $month );

		$response      = $this->runMonth();
		$days_in_month = (int) date( 't', strtotime( $month . '-01' ) );

		$this->assertTrue( $response->success );
		$this->assertSame( array(), $response->payload['unresolved'], 'Zdrowe API, a miesiąc nie został domknięty' );
		$this->assertFalse( $response->payload['partial'] );
		$this->assertCount( $days_in_month, $response->payload['days'], 'Nie każdy dzień miesiąca dostał odpowiedź' );

		$falsely_taken = array();
		$falsely_free  = array();
		foreach ( $response->payload['days'] as $iso => $units ) {
			$number = (int) substr( $iso, 8, 2 );
			if ( in_array( $number, $taken, true ) ) {
				if ( $units > 0 ) {
					$falsely_free[] = $number;
				}
				continue;
			}
			if ( $units <= 0 ) {
				$falsely_taken[] = $number;
			}
		}

		$this->assertSame(
			array(),
			$falsely_taken,
			'Dni WOLNE pokazane odwiedzającemu jako zajęte: ' . implode( ',', $falsely_taken )
		);
		$this->assertSame(
			array(),
			$falsely_free,
			'Dni ZAJĘTE pokazane jako wolne: ' . implode( ',', $falsely_free )
		);
		$this->assertLessThanOrEqual(
			Avably_Booking_Ajax::month_call_ceiling( $days_in_month ),
			$client->calls,
			'Poprawność opłacona przebiciem sufitu wywołań'
		);
	}

	/** @return array<string,array{0:int[]}> Rozkłady rezerwacji z sondy PM. */
	public static function fragmentationScenarios(): array {
		return array(
			'brak rezerwacji'       => array( array() ),
			'1 rezerwacja'          => array( array( 15 ) ),
			'2 rezerwacje'          => array( array( 8, 22 ) ),
			'3 rezerwacje'          => array( array( 5, 14, 25 ) ),
			'weekendy zajęte'       => array( array( 2, 3, 9, 10, 16, 17, 23, 24, 30 ) ),
			'co drugi dzień zajęty' => array( range( 1, 31, 2 ) ),
			'cały miesiąc zajęty'   => array( range( 1, 31 ) ),
			'skrajne dni zajęte'    => array( array( 1, 28 ) ),
		);
	}

	// ------------------------------------------------------------------
	// Bramka 2: współbieżność — drugie żądanie nie mnoży wywołań.
	// ------------------------------------------------------------------

	/**
	 * Audyt: 10 równoległych żądań month → 279 wywołań, bo cache lądował PO
	 * pętli i żądania w locie nie widziały się nawzajem. Symulacja
	 * współbieżności: W TRAKCIE pierwszego wywołania API żądania A (responder)
	 * uruchamiamy żądanie B tego samego miesiąca. B ma trafić na wpis-blokadę
	 * założoną PRZED pętlą i odpowiedzieć „spróbuj za chwilę" BEZ dotykania
	 * API. Przeniesienie blokady/cache'u za pętlę MUSI palić ten test.
	 */
	public function test_concurrent_month_request_does_not_multiply_api_calls(): void {
		$client        = null;
		$nested        = null;
		$nested_calls  = null;
		$client        = new AvablyScriptedRangeClient(
			function ( string $start, string $end, int $call_no ) use ( &$client, &$nested, &$nested_calls ): int {
				if ( 1 === $call_no ) {
					$before = $client->calls;
					try {
						Avably_Booking_Ajax::handle_month();
						$nested = 'brak-odpowiedzi';
					} catch ( AvablyTestJsonResponse $response ) {
						$nested = $response;
					}
					$nested_calls = $client->calls - $before;
				}
				return 4;
			}
		);
		AvablyTestState::$apiClient = $client;
		$this->seedMonthRequest( $this->futureMonth() );

		$outer = $this->runMonth();

		$this->assertTrue( $outer->success, 'Żądanie A (pierwsze) ma się dokończyć normalnie' );
		$this->assertInstanceOf( AvablyTestJsonResponse::class, $nested, 'Żądanie B nie zostało zakończone odpowiedzią JSON' );
		$this->assertFalse( $nested->success, 'Żądanie B w locie żądania A ma dostać odmowę tymczasową, nie drugi przebieg' );
		$this->assertSame( 0, $nested_calls, 'Żądanie współbieżne pomnożyło wywołania API' );
	}

	/** Po zakończeniu żądania A wynik siedzi w cache'u — C nie dotyka API. */
	public function test_completed_month_serves_next_request_from_cache(): void {
		$client                     = new AvablyScriptedRangeClient( static fn (): int => 2 );
		AvablyTestState::$apiClient = $client;
		$month                      = $this->futureMonth();

		$this->seedMonthRequest( $month );
		$first = $this->runMonth();
		$this->assertTrue( $first->success );
		$calls_after_first = $client->calls;
		$this->assertGreaterThan( 0, $calls_after_first );

		$this->seedMonthRequest( $month );
		$second = $this->runMonth();
		$this->assertTrue( $second->success );
		$this->assertSame( $calls_after_first, $client->calls, 'Cache miesiąca nie zadziałał — drugie żądanie dotknęło API' );
		$this->assertSame( $first->payload, $second->payload );
	}

	/**
	 * Klucz cache'u miesiąca MUSI rozróżniać adres API i klucz najemcy —
	 * po zmianie ustawień stary wpis nie ma prawa serwować cudzych/starych
	 * danych. Sam klucz transientu nie może nieść sekretu.
	 */
	public function test_month_cache_key_varies_with_settings_and_leaks_no_secret(): void {
		$month = $this->futureMonth();
		$today = date( 'Y-m-d' );
		$key_a = Avably_Booking_Ajax::month_cache_key( self::PRODUCT, $month, $today );

		AvablyTestState::$options['avably_booking_settings']['api_url'] = 'https://inny.example.test';
		$key_b = Avably_Booking_Ajax::month_cache_key( self::PRODUCT, $month, $today );

		AvablyTestState::$options['avably_booking_settings']['api_url']    = 'https://api.example.test';
		AvablyTestState::$options['avably_booking_settings']['key_prefix'] = 'avbl_ffffffff';
		$key_c = Avably_Booking_Ajax::month_cache_key( self::PRODUCT, $month, $today );

		$this->assertNotSame( $key_a, $key_b, 'Zmiana adresu API serwowałaby stare dane z cache' );
		$this->assertNotSame( $key_a, $key_c, 'Zmiana klucza (innego najemcy) serwowałaby cudze dane z cache' );
		foreach ( array( $key_a, $key_b, $key_c ) as $key ) {
			$this->assertStringNotContainsString( 'avbl_', $key );
			$this->assertDoesNotMatchRegularExpression( '/example/', $key, 'Klucz transientu niesie fragment konfiguracji' );
		}
	}

	// ------------------------------------------------------------------
	// Bramka 3: dławienie month i availability (asercja na LICZNIK).
	// ------------------------------------------------------------------

	public function test_month_rate_limit_stops_api_after_threshold(): void {
		$client                     = new AvablyScriptedRangeClient( static fn (): int => 2 );
		AvablyTestState::$apiClient = $client;
		$month                      = $this->futureMonth();

		// Każde żądanie o INNY produkt — omijamy cache, mierzymy sam limit.
		for ( $i = 1; $i <= Avably_Booking_Ajax::MONTH_RATE_LIMIT; $i++ ) {
			$this->seedMonthRequest( $month, sprintf( '2a2a2a2a-1111-4222-8333-%012d', $i ) );
			$response = $this->runMonth();
			$this->assertTrue( $response->success, "Żądanie {$i} odrzucone przed limitem" );
		}
		$calls_at_limit = $client->calls;
		$this->assertGreaterThan( 0, $calls_at_limit );

		$this->seedMonthRequest( $month, sprintf( '2a2a2a2a-1111-4222-8333-%012d', 999 ) );
		$over = $this->runMonth();
		$this->assertFalse( $over->success, 'Limit month nie zadziałał' );
		$this->assertSame( 429, $over->status );
		$this->assertSame( $calls_at_limit, $client->calls, 'Żądanie ponad limitem dotknęło API' );

		// Bramka U1: komunikat bez nazw zmiennych i kluczy ustawień.
		foreach ( array( 'api_url', 'api_key', 'avably_booking', 'REMOTE_ADDR', '$', 'transient' ) as $forbidden ) {
			$this->assertStringNotContainsString( $forbidden, (string) $over->payload['message'] );
		}
	}

	public function test_availability_rate_limit_stops_api_after_threshold(): void {
		$client                     = new AvablyScriptedRangeClient( static fn (): int => 2 );
		AvablyTestState::$apiClient = $client;

		for ( $i = 1; $i <= Avably_Booking_Ajax::AVAILABILITY_RATE_LIMIT; $i++ ) {
			$this->seedAvailabilityRequest();
			try {
				Avably_Booking_Ajax::handle_availability();
				$this->fail( 'handle_availability nie zakończył żądania' );
			} catch ( AvablyTestJsonResponse $response ) {
				$this->assertTrue( $response->success, "Żądanie {$i} odrzucone przed limitem" );
			}
		}
		$this->assertSame( Avably_Booking_Ajax::AVAILABILITY_RATE_LIMIT, $client->calls );

		$this->seedAvailabilityRequest();
		try {
			Avably_Booking_Ajax::handle_availability();
			$this->fail( 'Limit availability nie zadziałał' );
		} catch ( AvablyTestJsonResponse $response ) {
			$this->assertFalse( $response->success );
			$this->assertSame( 429, $response->status );
			$this->assertSame( Avably_Booking_Ajax::AVAILABILITY_RATE_LIMIT, $client->calls, 'Żądanie ponad limitem dotknęło API' );
		}
	}

	/** Kalendarz jest wołany częściej niż rezerwacja — limity dobrane OSOBNO. */
	public function test_calendar_limits_are_separate_and_looser_than_reserve(): void {
		$this->assertGreaterThan( Avably_Booking_Ajax::RESERVE_RATE_LIMIT, Avably_Booking_Ajax::MONTH_RATE_LIMIT );
		$this->assertGreaterThan( Avably_Booking_Ajax::MONTH_RATE_LIMIT, Avably_Booking_Ajax::AVAILABILITY_RATE_LIMIT );
	}

	// ------------------------------------------------------------------
	// Bramka 4: kubełek limitu a zaufane proxy.
	// ------------------------------------------------------------------

	/**
	 * Sklep za CDN-em/reverse proxy: WSZYSCY odwiedzający mają REMOTE_ADDR
	 * proxy. Przy JAWNIE skonfigurowanym zaufanym proxy (lista adresów +
	 * nagłówek) kubełek bierze klienta z nagłówka — dwaj odwiedzający NIE
	 * dzielą limitu i jeden bot nie wyłącza kalendarza całemu sklepowi.
	 */
	public function test_visitors_behind_configured_proxy_get_separate_buckets(): void {
		$trusted = array(
			'proxies' => array( '203.0.113.9' ),
			'header'  => 'X-Forwarded-For',
		);
		$a       = Avably_Booking_Ajax::visitor_bucket(
			array(
				'REMOTE_ADDR'          => '203.0.113.9',
				'HTTP_X_FORWARDED_FOR' => '198.51.100.1',
			),
			$trusted
		);
		$b       = Avably_Booking_Ajax::visitor_bucket(
			array(
				'REMOTE_ADDR'          => '203.0.113.9',
				'HTTP_X_FORWARDED_FOR' => '198.51.100.2',
			),
			$trusted
		);
		$this->assertNotSame( $a, $b, 'Odwiedzający za zaufanym proxy dzielą kubełek' );

		// XFF wielohopowe: liczy się OSTATNI wpis (dopisany przez zaufane
		// proxy) — podrobiony prefiks od klienta nie zmienia kubełka.
		$c = Avably_Booking_Ajax::visitor_bucket(
			array(
				'REMOTE_ADDR'          => '203.0.113.9',
				'HTTP_X_FORWARDED_FOR' => '6.6.6.6, 198.51.100.1',
			),
			$trusted
		);
		$this->assertSame( $a, $c, 'Podrobiony prefiks XFF zmienił kubełek' );
	}

	/** Lista zaufanych proxy przyjmuje też prefiksy CIDR (zakresy CDN-ów). */
	public function test_trusted_proxy_list_accepts_cidr(): void {
		$trusted = array(
			'proxies' => array( '203.0.113.0/24' ),
			'header'  => 'X-Forwarded-For',
		);
		$a       = Avably_Booking_Ajax::visitor_bucket(
			array(
				'REMOTE_ADDR'          => '203.0.113.77',
				'HTTP_X_FORWARDED_FOR' => '198.51.100.1',
			),
			$trusted
		);
		$b       = Avably_Booking_Ajax::visitor_bucket(
			array(
				'REMOTE_ADDR'          => '203.0.113.77',
				'HTTP_X_FORWARDED_FOR' => '198.51.100.2',
			),
			$trusted
		);
		$this->assertNotSame( $a, $b );
	}

	/**
	 * Napastnik łączący się BEZPOŚREDNIO (z pominięciem CDN-a) nie dostaje
	 * świeżego kubełka per podrobiony nagłówek: nagłówkowi ufamy WYŁĄCZNIE,
	 * gdy żądanie przychodzi z adresu na liście zaufanych proxy.
	 */
	public function test_forged_header_from_untrusted_remote_is_ignored(): void {
		$trusted = array(
			'proxies' => array( '203.0.113.9' ),
			'header'  => 'X-Forwarded-For',
		);
		$a       = Avably_Booking_Ajax::visitor_bucket(
			array(
				'REMOTE_ADDR'          => '198.51.100.77',
				'HTTP_X_FORWARDED_FOR' => '1.1.1.1',
			),
			$trusted
		);
		$b       = Avably_Booking_Ajax::visitor_bucket(
			array(
				'REMOTE_ADDR'          => '198.51.100.77',
				'HTTP_X_FORWARDED_FOR' => '2.2.2.2',
			),
			$trusted
		);
		$c       = Avably_Booking_Ajax::visitor_bucket( array( 'REMOTE_ADDR' => '198.51.100.77' ), $trusted );
		$this->assertSame( $a, $b, 'Podrobiony nagłówek spoza zaufanego proxy zmienił kubełek' );
		$this->assertSame( $a, $c );
	}

	/**
	 * BRAK konfiguracji = REMOTE_ADDR i ŚWIADOMY kompromis: za CDN-em wszyscy
	 * odwiedzający dzielą kubełek (pierwszy bot może wyczerpać limit całemu
	 * sklepowi do końca okna) — ale nagłówka klienta nie da się podrobić na
	 * świeży licznik. Wariant „ufamy X-Forwarded-For domyślnie" WYKLUCZONY.
	 */
	public function test_without_configuration_visitors_share_bucket_and_header_is_ignored(): void {
		$unconfigured = array(
			'proxies' => array(),
			'header'  => 'X-Forwarded-For',
		);
		$a            = Avably_Booking_Ajax::visitor_bucket(
			array(
				'REMOTE_ADDR'          => '203.0.113.9',
				'HTTP_X_FORWARDED_FOR' => '198.51.100.1',
			),
			$unconfigured
		);
		$b            = Avably_Booking_Ajax::visitor_bucket(
			array(
				'REMOTE_ADDR'          => '203.0.113.9',
				'HTTP_X_FORWARDED_FOR' => '198.51.100.2',
			),
			$unconfigured
		);
		$this->assertSame( $a, $b, 'Bez konfiguracji kubełkiem ma być REMOTE_ADDR' );
	}

	/**
	 * PRODUKCYJNE rozstrzygnięcie konfiguracji PRZYPIĘTE (lekcja D1/PR #216):
	 * wywołanie bez drugiego argumentu bierze konfigurację ze stałych — przy
	 * NIEZDEFINIOWANYCH stałych nagłówek MUSI być ignorowany.
	 */
	public function test_default_config_without_constants_ignores_forwarded_header(): void {
		$this->assertFalse(
			defined( 'AVABLY_BOOKING_TRUSTED_PROXIES' ),
			'Suita zdefiniowała stałą zaufanych proxy — dowód domyślnego rozstrzygnięcia wymaga czystego stanu'
		);
		$a = Avably_Booking_Ajax::visitor_bucket(
			array(
				'REMOTE_ADDR'          => '203.0.113.9',
				'HTTP_X_FORWARDED_FOR' => '198.51.100.1',
			)
		);
		$b = Avably_Booking_Ajax::visitor_bucket(
			array(
				'REMOTE_ADDR'          => '203.0.113.9',
				'HTTP_X_FORWARDED_FOR' => '198.51.100.2',
			)
		);
		$this->assertSame( $a, $b, 'Domyślna konfiguracja zaufała nagłówkowi klienta' );
	}

	// ------------------------------------------------------------------
	// Timeout i budżet czasu — zajeżdżanie workerów PHP.
	// ------------------------------------------------------------------

	/**
	 * Ścieżki ODCZYTU (kalendarz, availability, katalog) dostają krótki
	 * timeout; zapis rezerwacji zachowuje dłuższy. Audyt: przy API
	 * odpowiadającym w 2 s jedno żądanie month trzymało workera PHP ~60 s
	 * (timeout 15 s × pętla per dzień).
	 */
	public function test_read_paths_use_short_timeout_write_keeps_long(): void {
		$captured = array();
		$client   = new Avably_Booking_Api_Client(
			'https://api.example.test',
			AVABLY_TEST_API_KEY,
			static function ( array $args ) use ( &$captured ): array {
				$captured[] = $args;
				return array(
					'code' => 200,
					'body' => '{"available_units":1,"total_units":1}',
				);
			}
		);

		$client->get_availability( self::PRODUCT, '2027-03-01', '2027-03-02' );
		$client->get_catalog();
		$client->create_reservation( array( 'items' => array() ) );

		$this->assertSame( 5, Avably_Booking_Api_Client::TIMEOUT_READ, 'Timeout odczytu podniesiony — decyzja ADR-114' );
		$this->assertSame( 15, Avably_Booking_Api_Client::TIMEOUT_WRITE );
		$this->assertSame( Avably_Booking_Api_Client::TIMEOUT_READ, $captured[0]['timeout'] );
		$this->assertSame( Avably_Booking_Api_Client::TIMEOUT_READ, $captured[1]['timeout'] );
		$this->assertSame( Avably_Booking_Api_Client::TIMEOUT_WRITE, $captured[2]['timeout'] );
	}

	/**
	 * Budżet CZASU na całe żądanie month: po przekroczeniu oddajemy to, co
	 * mamy (dni nierozstrzygnięte zachowawczo jako 0), zamiast trzymać
	 * workera PHP na kolejnych wywołaniach.
	 */
	public function test_month_resolver_respects_time_budget(): void {
		$elapsed = 0.0;
		$client  = new AvablyScriptedRangeClient(
			function () use ( &$elapsed ): int {
				$elapsed += 3.0; // Każde wywołanie API „trwa" 3 s.
				return 0;        // Zajęte zakresy wymuszają kolejne podziały.
			}
		);

		$days    = Avably_Booking_Ajax::month_days( $this->futureMonth(), date( 'Y-m-d' ) );
		$ceiling = Avably_Booking_Ajax::month_call_ceiling( count( $days ) );
		$result  = Avably_Booking_Ajax::resolve_month_days(
			$client,
			self::PRODUCT,
			$days,
			$ceiling,
			10.0,
			static function () use ( &$elapsed ): float {
				return $elapsed;
			}
		);

		// Zegar: 0 → 3 → 6 → 9 (wolno wołać) → 12 (deadline 10 przekroczony).
		$this->assertSame( 4, $result['calls'], 'Budżet czasu nie zatrzymał pętli' );
		$this->assertLessThan( $ceiling, $result['calls'], 'Zatrzymał sufit wywołań, nie czas — test nic nie dowodzi' );
		$this->assertFalse( $result['complete'] );

		// Dzień bez odpowiedzi NIE UDAJE wyniku: nie ma go w `days` (gdzie 0
		// znaczy „naprawdę zajęty"), jest na jawnej liście `unresolved`.
		$this->assertSame( array(), $result['days'], 'Nierozstrzygnięty dzień dostał wartość, choć API nic o nim nie powiedziało' );
		$this->assertSame( $days, $result['unresolved'] );
		$this->assertCount(
			count( $days ),
			array_merge( array_keys( $result['days'] ), $result['unresolved'] ),
			'Dzień miesiąca zniknął — ma być albo rozstrzygnięty, albo jawnie nieznany'
		);
	}

	/**
	 * WOLNE API przez PRODUKCYJNE ciało handle_month (zegar podstawiony
	 * podklasą): budżet czasu przerywa rozstrzyganie, a odwiedzający dostaje
	 * odpowiedź, w której dzień NIEZNANY jest rozróżnialny od ZAJĘTEGO.
	 *
	 * To jest sedno delty recenzji PM #218: degradacja nie ma prawa udawać
	 * wyniku. Wcześniej niedopytany dzień wyjeżdżał jako `0` — nie do odróżnienia
	 * od dnia naprawdę zarezerwowanego.
	 */
	public function test_time_budget_leaves_days_unresolved_not_taken(): void {
		AvablySlowClockAjax::$now  = 0.0;
		AvablySlowClockAjax::$step = 3.0; // Każde spojrzenie na zegar = 3 s.

		// Pierwsza połowa miesiąca wolna, druga zajęta: podziały rozstrzygają
		// lewą połówkę jednym wywołaniem, a na prawą kończy się czas — payload
		// musi unieść OBA rodzaje dni naraz.
		$client                     = new AvablySingleUnitCalendarClient( range( 16, 31 ) );
		AvablyTestState::$apiClient = $client;
		$month                      = $this->futureMonth();
		$this->seedMonthRequest( $month );

		$response = null;
		try {
			AvablySlowClockAjax::handle_month();
		} catch ( AvablyTestJsonResponse $json ) {
			$response = $json;
		}

		$this->assertInstanceOf( AvablyTestJsonResponse::class, $response );
		$this->assertTrue( $response->success, 'Wynik częściowy nie jest błędem — jest częściowy' );
		$this->assertTrue( $response->payload['partial'], 'Odpowiedź nie przyznaje się do niekompletności' );
		$this->assertNotSame( array(), $response->payload['unresolved'], 'Budżet czasu nie odciął rozstrzygania — test nic nie dowodzi' );
		$this->assertNotSame( array(), $response->payload['days'], 'Nic się nie rozstrzygnęło — test nie pokazuje MIESZANEGO wyniku' );

		// Rozłączność: dzień jest albo rozstrzygnięty, albo nieznany.
		$this->assertSame(
			array(),
			array_intersect( array_keys( $response->payload['days'] ), $response->payload['unresolved'] ),
			'Ten sam dzień jest naraz rozstrzygnięty i nieznany'
		);
		// I nigdy nie wyjeżdża jako „zajęty" bez odpowiedzi API: wszystko, co
		// jest w `days`, ma pokrycie w faktycznym wywołaniu (tu: wolne dni).
		foreach ( $response->payload['days'] as $iso => $units ) {
			$this->assertGreaterThan( 0, $units, "Dzień {$iso} oddany jako zajęty, choć API o niego nie zapytano" );
		}

		// Wynik częściowy siedzi w cache'u KRÓTKO.
		$ttl = null;
		foreach ( AvablyTestState::$transientTtls as $transient_key => $value ) {
			if ( str_starts_with( $transient_key, 'avably_bk_m_' ) ) {
				$ttl = $value;
			}
		}
		$this->assertSame( Avably_Booking_Ajax::MONTH_DEGRADED_CACHE_TTL, $ttl );

		// Bramka U1: payload bez nazw zmiennych i kluczy ustawień.
		$serialized = (string) json_encode( $response->payload );
		foreach ( array( 'api_url', 'api_key', 'avbl_', 'MONTH_', 'transient', 'REMOTE_ADDR' ) as $forbidden ) {
			$this->assertStringNotContainsString( $forbidden, $serialized );
		}
	}

	/**
	 * Podniesiony sufit wywołań NIE MOŻE rozluźnić dławienia: jeden odwiedzający
	 * dalej nie przepuszcza więcej niż MONTH_RATE_LIMIT żądań w oknie, a łączny
	 * ruch do API najemcy zostaje ograniczony iloczynem limitu i sufitu —
	 * nie mnoży się przez liczbę żądań ponad limitem.
	 */
	public function test_raised_call_ceiling_does_not_relax_the_rate_limit(): void {
		// Najgorszy klient: każdy zakres zajęty ⇒ maksymalna liczba wywołań.
		$client                     = new AvablyScriptedRangeClient( static fn (): int => 0 );
		AvablyTestState::$apiClient = $client;
		$month                      = $this->futureMonth();
		$ceiling                    = Avably_Booking_Ajax::month_call_ceiling(
			(int) date( 't', strtotime( $month . '-01' ) )
		);

		for ( $i = 1; $i <= Avably_Booking_Ajax::MONTH_RATE_LIMIT; $i++ ) {
			$this->seedMonthRequest( $month, sprintf( '2a2a2a2a-1111-4222-8333-%012d', $i ) );
			$this->assertTrue( $this->runMonth()->success, "Żądanie {$i} odrzucone przed limitem" );
		}
		$calls_at_limit = $client->calls;
		$this->assertLessThanOrEqual(
			Avably_Booking_Ajax::MONTH_RATE_LIMIT * $ceiling,
			$calls_at_limit,
			'Ruch do API przekroczył iloczyn limitu żądań i sufitu wywołań'
		);

		// Dziesięć kolejnych żądań ponad limit: ZERO nowych wywołań API.
		for ( $i = 1; $i <= 10; $i++ ) {
			$this->seedMonthRequest( $month, sprintf( '2a2a2a2a-1111-4222-8333-%012d', 900 + $i ) );
			$over = $this->runMonth();
			$this->assertFalse( $over->success );
			$this->assertSame( 429, $over->status );
		}
		$this->assertSame( $calls_at_limit, $client->calls, 'Żądania ponad limitem dotknęły API mimo dławienia' );
	}

	/**
	 * Wpis-blokada nie może zablokować kalendarza NA STAŁE. Proces, który go
	 * założył, może paść przed usunięciem wpisu — wtedy jedyną drogą powrotu
	 * jest wygaśnięcie TTL.
	 */
	public function test_month_lock_expires_and_calendar_comes_back(): void {
		$client                     = new AvablyScriptedRangeClient( static fn (): int => 3 );
		AvablyTestState::$apiClient = $client;
		$month                      = $this->futureMonth();
		$lock_key                   = Avably_Booking_Ajax::month_lock_key( self::PRODUCT, $month, date( 'Y-m-d' ) );

		// Stan po padzie procesu: blokada wisi, wyniku w cache'u nie ma.
		set_transient( $lock_key, 1, Avably_Booking_Ajax::MONTH_LOCK_TTL );
		$this->seedMonthRequest( $month );
		$busy = $this->runMonth();
		$this->assertFalse( $busy->success );
		$this->assertSame( 'busy', $busy->payload['code'] );
		$this->assertSame( 0, $client->calls );

		// TTL wygasa — shim WP nie mierzy czasu, więc wygaśnięcie modelujemy
		// zniknięciem wpisu, czyli dokładnie tym, co robi transient w WP.
		delete_transient( $lock_key );
		$this->seedMonthRequest( $month );
		$back = $this->runMonth();
		$this->assertTrue( $back->success, 'Kalendarz nie wrócił po wygaśnięciu blokady' );
		$this->assertGreaterThan( 0, $client->calls );

		// TTL musi być SKOŃCZONY i pokrywać najgorszy przebieg: krótszy
		// zdejmowałby blokadę w trakcie rozstrzygania (wraca amplifikacja),
		// dłuższy trzymałby kalendarz zamknięty po padzie procesu.
		$this->assertGreaterThanOrEqual(
			Avably_Booking_Ajax::MONTH_TIME_BUDGET + Avably_Booking_Api_Client::TIMEOUT_READ,
			Avably_Booking_Ajax::MONTH_LOCK_TTL
		);
		$this->assertLessThanOrEqual( 60, Avably_Booking_Ajax::MONTH_LOCK_TTL );
	}

	/**
	 * Wynik KOMPLETNY dostaje pełny TTL — także wtedy, gdy miesiąc jest
	 * w całości zajęty. To rozróżnienie było wcześniej zepsute: „wszystko
	 * zajęte" brało krótki TTL, bo algorytm nie odróżniał miesiąca naprawdę
	 * zarezerwowanego od miesiąca, którego nie zdążył dopytać.
	 *
	 * Krótki TTL wyniku CZĘŚCIOWEGO pilnuje test budżetu czasu wyżej.
	 */
	public function test_complete_month_result_gets_full_cache_ttl(): void {
		foreach ( array( 2, 0 ) as $units ) {
			AvablyTestState::reset();
			$client                     = new AvablyScriptedRangeClient( static fn (): int => $units );
			AvablyTestState::$apiClient = $client;
			$month                      = $this->futureMonth();
			$this->seedMonthRequest( $month );

			$response = $this->runMonth();
			$this->assertFalse( $response->payload['partial'], "Miesiąc (dostępność {$units}) uznany za niekompletny" );

			$ttl = null;
			foreach ( AvablyTestState::$transientTtls as $transient_key => $value ) {
				if ( str_starts_with( $transient_key, 'avably_bk_m_' ) ) {
					$ttl = $value;
				}
			}
			$this->assertSame( Avably_Booking_Ajax::MONTH_CACHE_TTL, $ttl, "Kompletny wynik (dostępność {$units}) dostał krótki TTL" );
		}
		$this->assertLessThan( Avably_Booking_Ajax::MONTH_CACHE_TTL, Avably_Booking_Ajax::MONTH_DEGRADED_CACHE_TTL );
	}

	/** Częściowo zajęty miesiąc: podziały schodzą do dni, wynik jest wierny. */
	public function test_partially_booked_month_resolves_taken_days_exactly(): void {
		$month = $this->futureMonth();
		$taken = array( $month . '-05' ); // Jeden zajęty dzień.
		$client = new AvablyScriptedRangeClient(
			static function ( string $start, string $end ) use ( $taken ): int {
				foreach ( $taken as $day ) {
					if ( $start <= $day && $day <= $end ) {
						return 0; // Zakres obejmuje zajęty dzień ⇒ 0 wolnych sztuk na CAŁY zakres.
					}
				}
				return 2;
			}
		);
		AvablyTestState::$apiClient = $client;
		$this->seedMonthRequest( $month );

		$response = $this->runMonth();

		$this->assertTrue( $response->success );
		$this->assertSame( 0, $response->payload['days'][ $month . '-05' ], 'Zajęty dzień ma być zajęty' );
		$open = array_filter(
			$response->payload['days'],
			static fn ( int $units, string $day ): bool => $day !== $month . '-05',
			ARRAY_FILTER_USE_BOTH
		);
		foreach ( $open as $day => $units ) {
			$this->assertGreaterThan( 0, $units, "Dzień {$day} błędnie oznaczony jako zajęty" );
		}
		$this->assertSame( array(), $response->payload['unresolved'] );
		$this->assertLessThanOrEqual(
			Avably_Booking_Ajax::month_call_ceiling( (int) date( 't', strtotime( $month . '-01' ) ) ),
			$client->calls
		);
	}

	/**
	 * Żaden transient (klucze i wartości) nie niesie klucza API najemcy —
	 * na OBU ścieżkach: kompletnej i częściowej (ta druga zapisuje do cache'u
	 * inny payload, więc nie jest objęta przez pierwszą).
	 */
	public function test_transient_state_carries_no_api_key(): void {
		AvablySlowClockAjax::$now  = 0.0;
		AvablySlowClockAjax::$step = 3.0;

		foreach ( array( 'kompletna', 'czesciowa' ) as $path ) {
			AvablyTestState::reset();
			$client                     = new AvablyScriptedRangeClient( static fn (): int => 1 );
			AvablyTestState::$apiClient = $client;
			$this->seedMonthRequest( $this->futureMonth() );
			if ( 'kompletna' === $path ) {
				$this->runMonth();
			} else {
				try {
					AvablySlowClockAjax::handle_month();
				} catch ( AvablyTestJsonResponse $ignored ) {
					unset( $ignored );
				}
			}

			$serialized = (string) json_encode(
				array(
					'keys'   => array_keys( AvablyTestState::$transients ),
					'values' => array_values( array_diff_key( AvablyTestState::$transients, array( 'avably_booking_settings' => 1 ) ) ),
				)
			);
			$this->assertStringNotContainsString( AVABLY_TEST_API_KEY, $serialized, "Ścieżka {$path}: transient niesie klucz API" );
			$this->assertStringNotContainsString( 'avbl_', $serialized, "Ścieżka {$path}: transient niesie prefiks klucza" );
			$this->assertStringNotContainsString( 'api.example.test', $serialized, "Ścieżka {$path}: transient niesie adres API" );
		}
	}
}
