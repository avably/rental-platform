<?php
/**
 * Endpointy ajaxowe wtyczki (admin-ajax.php) — proxy SERVER-SIDE do API
 * Avably z nonce'em, ścisłym whitelistem parametrów i odpowiedziami
 * budowanymi z zamkniętych list pól.
 *
 * TO NIE JEST otwarte proxy (§5.2 briefu M2):
 *   - istnieją DOKŁADNIE trzy akcje (availability / month / reserve);
 *   - żadna nie przyjmuje ścieżki, URL-a ani nazwy endpointu — parametry to
 *     wyłącznie product_id (UUID), daty ISO i pola formularza rezerwacji;
 *   - wywołania do API idą przez Avably_Booking_Api_Client, który zna tylko
 *     trzy stałe ścieżki kontraktu v1;
 *   - odpowiedź do przeglądarki przechodzi przez whitelisty pól — surowe
 *     body API (i tym bardziej nagłówki z kluczem) nie wychodzą dalej.
 *
 * Dostępność jest odpytywana wyłącznie tędy (nigdy zapieczona w HTML-u
 * strony) — strona może stać za cache'em, dostępność nie może.
 */

if ( ! defined( 'ABSPATH' ) && ! defined( 'AVABLY_BOOKING_TESTSUITE' ) ) {
	exit;
}

class Avably_Booking_Ajax {

	public const NONCE_ACTION = 'avably_booking_flow';

	/** Maksymalny horyzont kalendarza: bieżący miesiąc + 12. */
	public const MONTH_HORIZON = 12;

	/** Czas życia cache'u miesiąca dostępności (sekundy). */
	public const MONTH_CACHE_TTL = 300;

	/**
	 * Krótki TTL dla wyniku CZĘŚCIOWEGO (budżet czasu przerwał rozstrzyganie —
	 * część dni jest NIEROZSTRZYGNIĘTA, a nie „zajęta"): wynik dalej zbija falę
	 * żądań współbieżnych, ale niepełny kalendarz nie wisi pełnych 5 minut.
	 */
	public const MONTH_DEGRADED_CACHE_TTL = 30;

	/**
	 * ZAPAS wywołań SONDUJĄCYCH ponad linię bazową „jedno wywołanie na dzień"
	 * (R11, delta recenzji PM #218 — ADR-114, decyzja 2a).
	 *
	 * Rachunek kosztu jest ścisły. Niech n = liczba dni do rozstrzygnięcia.
	 * Każde wywołanie kończy się jednym z trzech wyników:
	 *   - zakres z dostępnością > 0 (L dni jednym wywołaniem) → OSZCZĘDNOŚĆ L-1,
	 *   - pojedynczy dzień (dowolny wynik) → koszt dokładnie 1 dzień/1 wywołanie,
	 *   - zakres wielodniowy z wynikiem 0 → nie rozstrzyga NICZEGO (STRATA 1).
	 * Stąd: wywołania = n − oszczędności + straty. Rozstrzyganie startuje więc
	 * z zapasem MONTH_SPLIT_SLACK i wolno mu wykonać sondę zakresową tylko
	 * wtedy, gdy zapas jest dodatni; sonda z wynikiem 0 zapas zjada, zakres
	 * wolny go odbudowuje. Gdy zapas się skończy, dalej pytamy o POJEDYNCZE
	 * dni — a to zawsze domyka miesiąc.
	 *
	 * Wniosek z rachunku (zapisany w ADR-114): sufit twardszy niż n+zapas
	 * NIE ISTNIEJE dla algorytmu, który w ogóle zadaje pierwsze pytanie
	 * zakresowe — przy zapasie 0 pierwsza sonda całomiesięczna byłaby
	 * zabroniona i każdy miesiąc z choćby jedną rezerwacją kosztowałby n
	 * wywołań. Zapas 6 pokrywa najgłębsze zejście podziałami dla 31 dni
	 * (31→16→8→4→2 to pięć sond) z jedną sondą rezerwy.
	 */
	public const MONTH_SPLIT_SLACK = 6;

	/**
	 * Budżet CZASU (sekundy wall-clock) na rozstrzyganie miesiąca — po jego
	 * przekroczeniu oddajemy to, co mamy, zamiast trzymać workera PHP na
	 * kolejnych wywołaniach wolnego API.
	 */
	public const MONTH_TIME_BUDGET = 10;

	/**
	 * TTL wpisu-blokady „miesiąc w trakcie rozstrzygania": musi pokrywać
	 * najgorszy czas przebiegu (budżet czasu + jedno wywołanie, które
	 * przekroczyło deadline), a po padzie procesu PHP blokada ma sama
	 * wygasnąć, nie zawiesić kalendarza na stałe.
	 */
	public const MONTH_LOCK_TTL = 20;

	/**
	 * Dławienie ścieżek kalendarza PER ODWIEDZAJĄCY (R11): przed naprawą
	 * limit istniał wyłącznie na reserve, a najdroższa ścieżka (month) nie
	 * miała żadnego. Limity dobrane OSOBNO od rezerwacji — kalendarz jest
	 * wołany częściej (nawigacja po miesiącach, wybór zakresów), więc dostaje
	 * okna krótsze i pojemniejsze.
	 */
	public const MONTH_RATE_LIMIT           = 30;
	public const MONTH_RATE_WINDOW          = 300;
	public const AVAILABILITY_RATE_LIMIT    = 60;
	public const AVAILABILITY_RATE_WINDOW   = 300;

	/**
	 * Dławienie rezerwacji PER ODWIEDZAJĄCY (okno stałe).
	 *
	 * DLACZEGO WTYCZKA MUSI LICZYĆ SAMA: limity API (ADR-108) mają dwa
	 * wymiary — klucz i IP — ale IP, które widzi nasze API, to adres SERWERA
	 * WordPressa, wspólny dla wszystkich odwiedzających tę stronę. Wymiar IP
	 * jest więc po tamtej stronie ślepy, a wymiar klucza (30 rezerwacji/h)
	 * chroni najemcę PRZED WYCZERPANIEM, nie przed jednym botem, który ten
	 * budżet zje. Ten licznik odcina pojedynczego napastnika ZANIM dotknie
	 * naszego API.
	 */
	public const RESERVE_RATE_LIMIT = 10;
	public const RESERVE_RATE_WINDOW = 3600;

	public static function register(): void {
		add_action( 'wp_ajax_avably_booking_availability', array( __CLASS__, 'handle_availability' ) );
		add_action( 'wp_ajax_nopriv_avably_booking_availability', array( __CLASS__, 'handle_availability' ) );
		add_action( 'wp_ajax_avably_booking_month', array( __CLASS__, 'handle_month' ) );
		add_action( 'wp_ajax_nopriv_avably_booking_month', array( __CLASS__, 'handle_month' ) );
		add_action( 'wp_ajax_avably_booking_reserve', array( __CLASS__, 'handle_reserve' ) );
		add_action( 'wp_ajax_nopriv_avably_booking_reserve', array( __CLASS__, 'handle_reserve' ) );
	}

	// ------------------------------------------------------------------
	// Czyste parsery parametrów (testowalne bez WordPressa) — whitelist:
	// zwracają WYŁĄCZNIE rozpoznane, zwalidowane pola; wszystko inne ginie.
	// ------------------------------------------------------------------

	/**
	 * Parametry akcji availability: product_id + start_date + end_date.
	 *
	 * @param array $params Surowe parametry żądania.
	 * @return array{product_id:string,start_date:string,end_date:string}|null
	 */
	public static function parse_availability_params( array $params ): ?array {
		$product_id = self::scalar( $params, 'product_id' );
		$start_date = self::scalar( $params, 'start_date' );
		$end_date   = self::scalar( $params, 'end_date' );

		if ( ! preg_match( Avably_Booking_Api_Client::UUID_PATTERN, $product_id ) ) {
			return null;
		}
		if ( ! Avably_Booking_Validator::is_iso_date( $start_date ) || ! Avably_Booking_Validator::is_iso_date( $end_date ) ) {
			return null;
		}
		if ( $end_date < $start_date ) {
			return null;
		}
		return array(
			'product_id' => strtolower( $product_id ),
			'start_date' => $start_date,
			'end_date'   => $end_date,
		);
	}

	/**
	 * Parametry akcji month: product_id + month (YYYY-MM) w horyzoncie
	 * [bieżący miesiąc, +MONTH_HORIZON].
	 *
	 * @param array  $params Surowe parametry żądania.
	 * @param string $today  Data odniesienia (YYYY-MM-DD) — wstrzykiwana w testach.
	 * @return array{product_id:string,month:string}|null
	 */
	public static function parse_month_params( array $params, string $today ): ?array {
		$product_id = self::scalar( $params, 'product_id' );
		$month      = self::scalar( $params, 'month' );

		if ( ! preg_match( Avably_Booking_Api_Client::UUID_PATTERN, $product_id ) ) {
			return null;
		}
		if ( ! preg_match( '/^\d{4}-(0[1-9]|1[0-2])$/', $month ) ) {
			return null;
		}
		$current = substr( $today, 0, 7 );
		if ( $month < $current ) {
			return null;
		}
		$horizon = date( 'Y-m', strtotime( $current . '-01 +' . self::MONTH_HORIZON . ' months' ) );
		if ( $month > $horizon ) {
			return null;
		}
		return array(
			'product_id' => strtolower( $product_id ),
			'month'      => $month,
		);
	}

	/**
	 * Rdzeń dławienia (czysty, testowalny): stan okna → decyzja + nowy stan.
	 *
	 * @param array{start:int,count:int}|null $state Stan z transientu.
	 * @return array{allowed:bool,state:array{start:int,count:int}}
	 */
	public static function next_rate_state( ?array $state, int $now, int $window, int $limit ): array {
		if ( ! is_array( $state ) || ! isset( $state['start'], $state['count'] ) || ( $now - (int) $state['start'] ) >= $window ) {
			$state = array(
				'start' => $now,
				'count' => 0,
			);
		}
		$count = (int) $state['count'] + 1;
		return array(
			'allowed' => $count <= $limit,
			'state'   => array(
				'start' => (int) $state['start'],
				'count' => $count,
			),
		);
	}

	/**
	 * Adres odwiedzającego — WYŁĄCZNIE do kubełka limitu (nie do autoryzacji).
	 *
	 * DOMYŚLNIE kubełkiem jest REMOTE_ADDR: nagłówek klienta jest podrabialny,
	 * więc dałby napastnikowi świeży licznik na żądanie. ŚWIADOMY KOMPROMIS
	 * (ADR-114): za CDN-em/reverse proxy bez konfiguracji wszyscy odwiedzający
	 * zlewają się w jeden kubełek — pierwszy bot może wyczerpać limit całemu
	 * sklepowi do końca okna. Właściciel sklepu może temu zaradzić JAWNĄ
	 * konfiguracją zaufanego proxy (stałe w wp-config, patrz
	 * trusted_proxy_config()): nagłówkowi ufamy WYŁĄCZNIE, gdy żądanie
	 * przyszło z adresu na liście zaufanych proxy, i bierzemy OSTATNI wpis
	 * nagłówka (dopisany przez to proxy) — podrobiony prefiks od klienta
	 * niczego nie zmienia. Wariant „ufamy X-Forwarded-For domyślnie" jest
	 * wykluczony z konstrukcji.
	 *
	 * @param array                                            $server  Superglobal $_SERVER (wstrzykiwany w testach).
	 * @param array{proxies:string[],header:string}|null       $trusted Konfiguracja zaufanego proxy; null = ze stałych
	 *                                                                  (rozstrzygnięcie produkcyjne, przypięte testem).
	 */
	public static function visitor_bucket( array $server, ?array $trusted = null ): string {
		if ( null === $trusted ) {
			$trusted = self::trusted_proxy_config();
		}
		$remote = isset( $server['REMOTE_ADDR'] ) && is_scalar( $server['REMOTE_ADDR'] )
			? (string) $server['REMOTE_ADDR']
			: 'unknown';
		$ip = $remote;

		if ( array() !== $trusted['proxies'] && self::ip_matches_any( $remote, $trusted['proxies'] ) ) {
			$header_key = 'HTTP_' . strtoupper( str_replace( '-', '_', $trusted['header'] ) );
			if ( isset( $server[ $header_key ] ) && is_scalar( $server[ $header_key ] ) ) {
				// Ostatni wpis = dopisany przez zaufane proxy (semantyka XFF:
				// każdy hop dokleja adres, który WIDZIAŁ). Wcześniejsze wpisy
				// pochodzą od klienta i są podrabialne — ignorujemy je.
				$parts     = explode( ',', (string) $server[ $header_key ] );
				$candidate = trim( (string) end( $parts ) );
				if ( '' !== $candidate ) {
					$ip = $candidate;
				}
			}
		}
		return md5( $ip );
	}

	/**
	 * Konfiguracja zaufanego proxy ze stałych wp-config (brak stałych =
	 * brak zaufania do nagłówków):
	 *   - AVABLY_BOOKING_TRUSTED_PROXIES — lista adresów proxy po przecinku
	 *     (IP lub prefiks IPv4 CIDR, np. '203.0.113.9, 173.245.48.0/20');
	 *   - AVABLY_BOOKING_TRUSTED_PROXY_HEADER — nagłówek z adresem klienta
	 *     (domyślnie X-Forwarded-For; CDN-y miewają własne pojedyncze).
	 *
	 * @return array{proxies:string[],header:string}
	 */
	public static function trusted_proxy_config(): array {
		$proxies = array();
		if ( defined( 'AVABLY_BOOKING_TRUSTED_PROXIES' ) && is_string( AVABLY_BOOKING_TRUSTED_PROXIES ) ) {
			foreach ( explode( ',', AVABLY_BOOKING_TRUSTED_PROXIES ) as $entry ) {
				$entry = trim( $entry );
				if ( '' !== $entry ) {
					$proxies[] = $entry;
				}
			}
		}
		$header = 'X-Forwarded-For';
		if ( defined( 'AVABLY_BOOKING_TRUSTED_PROXY_HEADER' ) && is_string( AVABLY_BOOKING_TRUSTED_PROXY_HEADER )
			&& '' !== trim( AVABLY_BOOKING_TRUSTED_PROXY_HEADER ) ) {
			$header = trim( AVABLY_BOOKING_TRUSTED_PROXY_HEADER );
		}
		return array(
			'proxies' => $proxies,
			'header'  => $header,
		);
	}

	/**
	 * Czy adres pasuje do któregoś wpisu listy zaufanych proxy: dopasowanie
	 * DOKŁADNE albo prefiks IPv4 CIDR. Wpis nierozpoznany (literówka) nie
	 * pasuje do niczego — fail-closed w stronę REMOTE_ADDR.
	 */
	public static function ip_matches_any( string $ip, array $entries ): bool {
		foreach ( $entries as $entry ) {
			if ( ! is_string( $entry ) || '' === $entry ) {
				continue;
			}
			if ( $ip === $entry ) {
				return true;
			}
			if ( str_contains( $entry, '/' ) && self::ipv4_in_cidr( $ip, $entry ) ) {
				return true;
			}
		}
		return false;
	}

	/** Dopasowanie IPv4 do prefiksu CIDR (a.b.c.d/nn); śmieć => false. */
	private static function ipv4_in_cidr( string $ip, string $cidr ): bool {
		$split = explode( '/', $cidr, 2 );
		if ( 2 !== count( $split ) ) {
			return false;
		}
		list( $network, $bits_raw ) = $split;
		if ( ! preg_match( '/^\d{1,2}$/', $bits_raw ) ) {
			return false;
		}
		$bits = (int) $bits_raw;
		if ( $bits > 32 ) {
			return false;
		}
		$ip_long  = ip2long( $ip );
		$net_long = ip2long( $network );
		if ( false === $ip_long || false === $net_long ) {
			return false;
		}
		$mask = 0 === $bits ? 0 : ( ~0 << ( 32 - $bits ) ) & 0xFFFFFFFF;
		return ( $ip_long & $mask ) === ( $net_long & $mask );
	}

	/**
	 * Whitelist odpowiedzi availability: wyłącznie liczby dostępności.
	 *
	 * @return array{available_units:int,total_units:int}
	 */
	public static function pick_availability( array $data ): array {
		return array(
			'available_units' => isset( $data['available_units'] ) ? (int) $data['available_units'] : 0,
			'total_units'     => isset( $data['total_units'] ) ? (int) $data['total_units'] : 0,
		);
	}

	/**
	 * Whitelist odpowiedzi rezerwacji: podsumowanie zamówienia klienta —
	 * ZAMKNIĘTA lista pól kontraktu (bez pól diagnostycznych, bez uchwytów).
	 *
	 * @param array $data Odpowiedź 201 API (status/nextStep/order).
	 * @return array{order_number:string,start_date:string,end_date:string,payment_method:string,delivery_method:string,total_rental_grosze:int,total_deposit_grosze:int,delivery_grosze:int,currency:string}
	 */
	public static function pick_order_summary( array $data ): array {
		$order = isset( $data['order'] ) && is_array( $data['order'] ) ? $data['order'] : array();
		return array(
			'order_number'         => isset( $order['orderNumber'] ) ? (string) $order['orderNumber'] : '',
			'start_date'           => isset( $order['startDate'] ) ? (string) $order['startDate'] : '',
			'end_date'             => isset( $order['endDate'] ) ? (string) $order['endDate'] : '',
			'payment_method'       => isset( $order['paymentMethod'] ) ? (string) $order['paymentMethod'] : '',
			'delivery_method'      => isset( $order['deliveryMethod'] ) ? (string) $order['deliveryMethod'] : '',
			'total_rental_grosze'  => isset( $order['totalRentalGrosze'] ) ? (int) $order['totalRentalGrosze'] : 0,
			'total_deposit_grosze' => isset( $order['totalDepositGrosze'] ) ? (int) $order['totalDepositGrosze'] : 0,
			'delivery_grosze'      => isset( $order['deliveryGrosze'] ) ? (int) $order['deliveryGrosze'] : 0,
			'currency'             => isset( $order['currency'] ) ? (string) $order['currency'] : 'PLN',
		);
	}

	/**
	 * Lista dni miesiąca do odpytania (od dnia odniesienia, jeśli miesiąc
	 * bieżący — przeszłość nie jest rezerwowalna, więc jej nie odpytujemy).
	 *
	 * @return string[] Daty ISO.
	 */
	public static function month_days( string $month, string $today ): array {
		$first = $month . '-01';
		$count = (int) date( 't', strtotime( $first ) );
		$days  = array();
		for ( $i = 1; $i <= $count; $i++ ) {
			$day = sprintf( '%s-%02d', $month, $i );
			if ( $day < $today ) {
				continue;
			}
			$days[] = $day;
		}
		return $days;
	}

	/**
	 * Sufit wywołań API na JEDNO żądanie month: linia bazowa „jedno wywołanie
	 * na dzień" (dokładnie tyle kosztowało żądanie PRZED naprawą R11) plus
	 * zapas na sondy zakresowe. Sufit jest WYPROWADZONY z liczby dni, nie
	 * zaklepany liczbą — polityka, nie magiczna stała (ADR-114, decyzja 2a).
	 *
	 * Sufit jest zabezpieczeniem, nie narzędziem: rachunek z MONTH_SPLIT_SLACK
	 * gwarantuje, że rozstrzyganie domyka miesiąc POD nim. Gdyby kiedykolwiek
	 * został dotknięty, dni bez odpowiedzi wychodzą jako NIEROZSTRZYGNIĘTE —
	 * nigdy jako zajęte.
	 */
	public static function month_call_ceiling( int $day_count ): int {
		if ( $day_count <= 0 ) {
			return 0;
		}
		return $day_count + self::MONTH_SPLIT_SLACK;
	}

	/**
	 * Zegar wall-clock rozstrzygania miesiąca — JEDYNE miejsce, w którym ta
	 * ścieżka pyta o czas. Wołany przez `static::`, więc test może podstawić
	 * własny bieg zegara podklasą i przepuścić przez PRODUKCYJNE ciało
	 * handle_month scenariusz wolnego API (bez czekania 10 s naprawdę).
	 */
	public static function now(): float {
		return microtime( true );
	}

	/**
	 * Rozstrzyganie dostępności miesiąca ZAKRESAMI zamiast pętli per dzień
	 * (R11, ADR-114). Publiczne API zwraca dla zakresu liczbę sztuk wolnych
	 * przez CAŁY zakres — to DOLNE OGRANICZENIE dostępności każdego dnia
	 * zakresu (sztuka wolna przez cały zakres jest wolna każdego dnia), więc
	 * wynik > 0 wystarcza siatce kalendarza, która rozstrzyga po `> 0`.
	 *
	 * Algorytm: zapytaj o cały zakres; wynik > 0 => wszystkie dni dostają tę
	 * wartość; wynik 0 na zakresie wielodniowym => podziel na pół i zapytaj
	 * o połówki (0 na zakresie NIE przesądza o żadnym dniu z osobna — inna
	 * sztuka może być zajęta każdego dnia).
	 *
	 * KOREKTA PO RECENZJI PM #218 — kalendarz nie ma prawa kłamać. Wcześniejsza
	 * wersja przycinała podziały twardym budżetem 12 wywołań i oddawała dni
	 * nierozstrzygnięte jako zachowawcze `0`; przy DWÓCH rezerwacjach w miesiącu
	 * kończyło się to czternastoma wolnymi dniami pokazanymi odwiedzającemu jako
	 * zajęte. Teraz podziały mają ZAPAS (MONTH_SPLIT_SLACK), a po jego zjedzeniu
	 * rozstrzyganie schodzi do pytań o POJEDYNCZE dni — każde takie wywołanie
	 * rozstrzyga dokładnie jeden dzień, więc miesiąc zawsze się domyka, a łączny
	 * koszt nie przekracza month_call_ceiling().
	 *
	 * Dzień, dla którego rozstrzyganie NIE dostało odpowiedzi (budżet czasu na
	 * wolnym API), nie trafia do `days` w ogóle — wychodzi na liście
	 * `unresolved`. Zajęte i nieznane to dwie różne rzeczy i front ma je
	 * rozróżniać.
	 *
	 * @param Avably_Booking_Api_Client $client       Klient API.
	 * @param string                    $product_id   Produkt (UUID, zwalidowany).
	 * @param string[]                  $days         CIĄGŁA lista dat ISO (month_days()).
	 * @param int                       $call_ceiling Sufit wywołań API (month_call_ceiling()).
	 * @param float                     $deadline     Chwila zegara, po której nie wolno wołać dalej.
	 * @param callable|null             $clock        Zegar (wstrzykiwany w testach); null = static::now().
	 * @return array{days:array<string,int>, unresolved:string[], complete:bool, calls:int, failure:?array}
	 */
	public static function resolve_month_days( Avably_Booking_Api_Client $client, string $product_id, array $days, int $call_ceiling, float $deadline, ?callable $clock = null ): array {
		if ( null === $clock ) {
			$clock = array( static::class, 'now' );
		}
		$days     = array_values( $days );
		$count    = count( $days );
		$resolved = array();
		if ( 0 === $count ) {
			return self::month_resolution( $days, $resolved, 0, null );
		}

		// Zapas sond zakresowych (patrz MONTH_SPLIT_SLACK): dodatni pozwala
		// zadać pytanie, które MOŻE nie rozstrzygnąć żadnego dnia.
		$slack = self::MONTH_SPLIT_SLACK;
		$calls = 0;
		$stack = array( array( 0, $count - 1 ) );

		while ( array() !== $stack ) {
			if ( $calls >= $call_ceiling || $clock() >= $deadline ) {
				// Budżet czasu (albo — teoretycznie — sufit wywołań) przerwał
				// rozstrzyganie: dni bez odpowiedzi zostają NIEROZSTRZYGNIĘTE.
				break;
			}
			list( $lo, $hi ) = array_pop( $stack );
			$length          = $hi - $lo + 1;

			if ( $length > 1 && $slack < 1 ) {
				// Zapas zjedzony — dalej wyłącznie pytania o pojedyncze dni.
				// Kosztują 1 wywołanie na 1 rozstrzygnięty dzień, więc od tego
				// miejsca rachunek już nie rośnie ponad linię bazową.
				for ( $i = $hi; $i >= $lo; $i-- ) {
					$stack[] = array( $i, $i );
				}
				continue;
			}

			$result = $client->get_availability( $product_id, $days[ $lo ], $days[ $hi ] );
			$calls++;
			if ( ! $result['ok'] ) {
				// Pierwszy błąd przerywa rozstrzyganie — komunikat ogólny
				// zamiast palenia limitu żądań na martwym kluczu/produkcie.
				return self::month_resolution( $days, $resolved, $calls, $result );
			}
			$picked = self::pick_availability( (array) $result['data'] );
			$units  = $picked['available_units'];

			if ( $units > 0 ) {
				for ( $i = $lo; $i <= $hi; $i++ ) {
					$resolved[ $days[ $i ] ] = $units;
				}
				$slack += $length - 1; // Zakres wolny odbudowuje zapas.
				continue;
			}
			if ( $lo === $hi ) {
				$resolved[ $days[ $lo ] ] = 0; // Pojedynczy dzień: 0 jest wynikiem dokładnym.
				continue;
			}
			$slack--; // Sonda zakresowa bez rozstrzygnięcia — zapas w dół.
			$mid = intdiv( $lo + $hi, 2 );
			// Lewa połówka na wierzch stosu — rozstrzyganie idzie od początku
			// miesiąca, więc przy odcięciu budżetem czasu nierozstrzygnięte
			// zostają dni najdalsze, nie najbliższe.
			$stack[] = array( $mid + 1, $hi );
			$stack[] = array( $lo, $mid );
		}

		return self::month_resolution( $days, $resolved, $calls, null );
	}

	/**
	 * Wynik rozstrzygania w kolejności dni miesiąca + jawna lista dni bez
	 * odpowiedzi. `complete` znaczy DOKŁADNIE „każdy dzień ma odpowiedź".
	 *
	 * @param string[]           $days     Wszystkie dni żądanego miesiąca.
	 * @param array<string,int>  $resolved Dni z odpowiedzią (klucz => sztuki).
	 * @param array|null         $failure  Odmowa API, jeśli przerwała przebieg.
	 * @return array{days:array<string,int>, unresolved:string[], complete:bool, calls:int, failure:?array}
	 */
	private static function month_resolution( array $days, array $resolved, int $calls, ?array $failure ): array {
		$ordered    = array();
		$unresolved = array();
		foreach ( $days as $day ) {
			if ( array_key_exists( $day, $resolved ) ) {
				$ordered[ $day ] = $resolved[ $day ];
				continue;
			}
			$unresolved[] = $day;
		}
		return array(
			'days'       => $ordered,
			'unresolved' => $unresolved,
			'complete'   => null === $failure && array() === $unresolved,
			'calls'      => $calls,
			'failure'    => $failure,
		);
	}

	/**
	 * Wspólny hash stanu konfiguracji dla kluczy transientów miesiąca:
	 * adres API i prefiks klucza MUSZĄ różnicować wpisy (zmiana ustawień nie
	 * może serwować starych/cudzych danych), a md5 gwarantuje, że klucz
	 * transientu nie niesie ani fragmentu konfiguracji, ani sekretu.
	 */
	private static function month_scope_hash( string $product_id, string $month, string $today ): string {
		$settings = Avably_Booking_Settings::get();
		return md5( $settings['api_url'] . '|' . $settings['key_prefix'] . '|' . $product_id . '|' . $month . '|' . $today );
	}

	/** Klucz cache'u miesiąca (publiczny: testy współbieżności go seedują). */
	public static function month_cache_key( string $product_id, string $month, string $today ): string {
		return 'avably_bk_m_' . self::month_scope_hash( $product_id, $month, $today );
	}

	/** Klucz wpisu-blokady „miesiąc w trakcie rozstrzygania". */
	public static function month_lock_key( string $product_id, string $month, string $today ): string {
		return 'avably_bk_mlk_' . self::month_scope_hash( $product_id, $month, $today );
	}

	// ------------------------------------------------------------------
	// Handlery WP (nonce => parsery => klient => whitelist odpowiedzi).
	// ------------------------------------------------------------------

	/** GET availability: dostępność zakresu dat dla produktu. */
	public static function handle_availability(): void {
		self::guard();
		// Dławienie PRZED walidacją i przed dotknięciem API (R11) — jak przy
		// rezerwacji: IP widziane przez nasze API to adres serwera WP, więc
		// wtyczka musi liczyć sama.
		self::enforce_rate_limit( 'avail', self::AVAILABILITY_RATE_LIMIT, self::AVAILABILITY_RATE_WINDOW );
		$params = self::parse_availability_params( wp_unslash( $_GET ) );
		if ( null === $params ) {
			wp_send_json_error( array( 'message' => Avably_Booking_Contract::error_message( 'validation_failed' ) ), 400 );
		}

		$client = Avably_Booking_Plugin::api_client();
		$result = $client->get_availability( $params['product_id'], $params['start_date'], $params['end_date'] );
		if ( ! $result['ok'] ) {
			self::send_api_error( $result );
		}
		wp_send_json_success( self::pick_availability( (array) $result['data'] ) );
	}

	/**
	 * GET month: dostępność per dzień dla siatki kalendarza.
	 *
	 * Konstrukcja R11 (ADR-114) — trzy zapory między odwiedzającym a API:
	 *   1. dławienie per odwiedzający (przed czymkolwiek innym),
	 *   2. cache miesiąca + wpis-blokada zakładana PRZED rozstrzyganiem
	 *      (żądania współbieżne dostają odmowę tymczasową `busy` zamiast
	 *      własnego przebiegu — front ponawia po chwili i trafia w cache),
	 *   3. rozstrzyganie zakresami (resolve_month_days) zamiast pętli per dzień
	 *      — z sufitem wywołań wyprowadzonym z liczby dni i budżetem czasu.
	 *
	 * Sufit wywołań NIE JEST narzędziem obrony przed współbieżnością (od tego
	 * są punkty 1 i 2) i dlatego nie wolno mu ciąć poprawności: miesiąc jest
	 * rozstrzygany do końca, a dni bez odpowiedzi wychodzą jako
	 * NIEROZSTRZYGNIĘTE, nie jako zajęte.
	 *
	 * SEMANTYKA BLOKADY: get/set_transient nie jest atomowe, więc dwa żądania
	 * mogą minąć się między odczytem a zapisem blokady i oba ruszyć. Blokada
	 * łapie falę typową (żądania przychodzące PO założeniu wpisu — to one
	 * robiły amplifikację ~300 wywołań przy 10 równoległych), nie doskonały
	 * wyścig — koszt przegranej to jeden nadmiarowy przebieg, nie lawina.
	 */
	public static function handle_month(): void {
		self::guard();
		self::enforce_rate_limit( 'month', self::MONTH_RATE_LIMIT, self::MONTH_RATE_WINDOW );
		$today  = current_time( 'Y-m-d' );
		$params = self::parse_month_params( wp_unslash( $_GET ), $today );
		if ( null === $params ) {
			wp_send_json_error( array( 'message' => Avably_Booking_Contract::error_message( 'validation_failed' ) ), 400 );
		}

		$cache_key = self::month_cache_key( $params['product_id'], $params['month'], $today );
		$cached    = get_transient( $cache_key );
		if ( is_array( $cached ) ) {
			wp_send_json_success( $cached );
		}

		$lock_key = self::month_lock_key( $params['product_id'], $params['month'], $today );
		if ( false !== get_transient( $lock_key ) ) {
			// Ktoś inny właśnie rozstrzyga ten miesiąc — wynik za chwilę
			// będzie w cache'u. Kod `busy` mówi frontowi „ponów cicho";
			// komunikat (dla klienta bez ponowienia) bez szczegółów
			// technicznych, jak każe bramka U1.
			wp_send_json_error(
				array(
					'message' => Avably_Booking_Contract::error_message( 'rate_limited' ),
					'code'    => 'busy',
				),
				429
			);
		}
		set_transient( $lock_key, 1, self::MONTH_LOCK_TTL );

		$client     = Avably_Booking_Plugin::api_client();
		$month_days = self::month_days( $params['month'], $today );
		$result     = self::resolve_month_days(
			$client,
			$params['product_id'],
			$month_days,
			self::month_call_ceiling( count( $month_days ) ),
			static::now() + self::MONTH_TIME_BUDGET
		);

		if ( null !== $result['failure'] ) {
			delete_transient( $lock_key );
			self::send_api_error( $result['failure'] );
		}

		// `days` niesie WYŁĄCZNIE dni z odpowiedzią API (0 = naprawdę zajęty).
		// Dzień bez odpowiedzi jest w `unresolved` i front pokazuje go
		// neutralnie — „zajęte" byłoby zmyśleniem, którego nikt nie zgłosi.
		$payload = array(
			'month'      => $params['month'],
			'days'       => $result['days'],
			'unresolved' => $result['unresolved'],
			'partial'    => ! $result['complete'],
		);
		set_transient(
			$cache_key,
			$payload,
			$result['complete'] ? self::MONTH_CACHE_TTL : self::MONTH_DEGRADED_CACHE_TTL
		);
		delete_transient( $lock_key );
		wp_send_json_success( $payload );
	}

	/** POST reserve: walidacja formularza => rezerwacja w API => podsumowanie. */
	public static function handle_reserve(): void {
		self::guard();
		if ( ! isset( $_SERVER['REQUEST_METHOD'] ) || 'POST' !== $_SERVER['REQUEST_METHOD'] ) {
			wp_send_json_error( array( 'message' => Avably_Booking_Contract::error_message( 'validation_failed' ) ), 400 );
		}

		// Dławienie PRZED walidacją i przed dotknięciem API — patrz stała
		// RESERVE_RATE_LIMIT (IP widziane przez nasze API to adres serwera WP).
		self::enforce_rate_limit( 'reserve', self::RESERVE_RATE_LIMIT, self::RESERVE_RATE_WINDOW );

		$input     = wp_unslash( $_POST );
		$locale    = str_starts_with( (string) get_locale(), 'pl' ) ? 'pl' : 'en';
		$validated = Avably_Booking_Validator::validate( $input, Avably_Booking_Plugin::terms_version(), $locale );
		if ( ! $validated['ok'] ) {
			wp_send_json_error(
				array(
					'message' => Avably_Booking_Contract::error_message( 'validation_failed' ),
					'fields'  => Avably_Booking_Contract::field_messages( $validated['errors'] ),
				),
				400
			);
		}

		$client = Avably_Booking_Plugin::api_client();
		$result = $client->create_reservation( $validated['body'] );
		if ( ! $result['ok'] ) {
			self::send_api_error( $result );
		}

		wp_send_json_success( array( 'order' => self::pick_order_summary( (array) $result['data'] ) ) );
	}

	// ------------------------------------------------------------------

	/** Wspólna bramka: nonce + zakaz cache'owania odpowiedzi. */
	private static function guard(): void {
		nocache_headers();
		check_ajax_referer( self::NONCE_ACTION, 'nonce' );
	}

	/**
	 * Dławienie per odwiedzający i PER AKCJA (okno stałe, rdzeń w
	 * next_rate_state). Osobne kubełki per akcja: najdroższa ścieżka (month)
	 * nie może wyżerać budżetu rezerwacjom ani odwrotnie. Przekroczenie
	 * limitu kończy żądanie ZANIM wtyczka dotknie API najemcy — komunikat
	 * ogólny, bez nazw zmiennych i kluczy ustawień (bramka U1).
	 */
	private static function enforce_rate_limit( string $action, int $limit, int $window ): void {
		$bucket   = 'avably_bk_rl_' . $action . '_' . self::visitor_bucket( $_SERVER );
		$stored   = get_transient( $bucket );
		$decision = self::next_rate_state(
			is_array( $stored ) ? $stored : null,
			time(),
			$window,
			$limit
		);
		set_transient( $bucket, $decision['state'], $window );
		if ( ! $decision['allowed'] ) {
			wp_send_json_error( array( 'message' => Avably_Booking_Contract::error_message( 'rate_limited' ) ), 429 );
		}
	}

	/**
	 * Jednolita odmowa z API: kod kontraktu => komunikat bez szczegółów
	 * technicznych (mapa Avably_Booking_Contract). Kończy żądanie.
	 *
	 * @param array $result Wynik klienta (ok=false).
	 */
	private static function send_api_error( array $result ): void {
		$code    = isset( $result['error_code'] ) && is_string( $result['error_code'] ) ? $result['error_code'] : 'server_error';
		$payload = array(
			'message' => Avably_Booking_Contract::error_message( $code ),
			'code'    => in_array( $code, Avably_Booking_Contract::ERROR_CODES, true ) ? $code : 'server_error',
		);
		if ( isset( $result['fields'] ) && is_array( $result['fields'] ) ) {
			$payload['fields'] = Avably_Booking_Contract::field_messages( $result['fields'] );
		}
		$status_map = array(
			'unauthorized'        => 502, // Problem konfiguracji operatora, nie klienta końcowego.
			'store_unavailable'   => 503,
			'rate_limited'        => 429,
			'validation_failed'   => 400,
			'not_found'           => 404,
			'conflict'            => 409,
			'rejected'            => 422,
			'payment_unavailable' => 409,
			'server_error'        => 502,
		);
		$status = isset( $status_map[ $code ] ) ? $status_map[ $code ] : 502;
		wp_send_json_error( $payload, $status );
	}

	/** Parametr skalarny jako przycięty string (nie-skalar => pusty). */
	private static function scalar( array $params, string $key ): string {
		if ( ! isset( $params[ $key ] ) || ! is_scalar( $params[ $key ] ) ) {
			return '';
		}
		return trim( (string) $params[ $key ] );
	}
}
