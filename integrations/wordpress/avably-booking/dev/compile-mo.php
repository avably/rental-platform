<?php
/**
 * Kompilator .po => .mo (minimalny, bez zależności) — używany w dev,
 * bo msgfmt nie jest dostępny na każdej maszynie.
 *
 * Użycie: php dev/compile-mo.php languages/avably-booking-pl_PL.po
 * Tworzy plik .mo obok wejściowego .po.
 *
 * Obsługuje podzbiór formatu PO wystarczający dla tej wtyczki:
 * msgid/msgstr (także wieloliniowe), komentarze. Bez liczby mnogiej
 * i bez kontekstów (nie używamy ich).
 */

if ( PHP_SAPI !== 'cli' ) {
	exit( 1 );
}

$po_path = $argv[1] ?? '';
if ( '' === $po_path || ! is_file( $po_path ) ) {
	fwrite( STDERR, "Podaj ścieżkę do pliku .po\n" );
	exit( 1 );
}

$lines   = file( $po_path, FILE_IGNORE_NEW_LINES );
$entries = array();
$msgid   = null;
$msgstr  = null;
$mode    = null;

$unquote = static function ( string $line ): string {
	$value = trim( $line );
	if ( '' === $value || '"' !== $value[0] ) {
		return '';
	}
	return stripcslashes( substr( $value, 1, -1 ) );
};

$flush = static function () use ( &$entries, &$msgid, &$msgstr ) {
	if ( null !== $msgid && null !== $msgstr && '' !== $msgstr ) {
		$entries[ $msgid ] = $msgstr;
	}
	$msgid  = null;
	$msgstr = null;
};

foreach ( $lines as $line ) {
	$trimmed = trim( $line );
	if ( '' === $trimmed || '#' === $trimmed[0] ) {
		continue;
	}
	if ( str_starts_with( $trimmed, 'msgid ' ) ) {
		$flush();
		$mode  = 'id';
		$msgid = $unquote( substr( $trimmed, 6 ) );
		continue;
	}
	if ( str_starts_with( $trimmed, 'msgstr ' ) ) {
		$mode   = 'str';
		$msgstr = $unquote( substr( $trimmed, 7 ) );
		continue;
	}
	if ( '"' === $trimmed[0] ) {
		if ( 'id' === $mode ) {
			$msgid .= $unquote( $trimmed );
		} elseif ( 'str' === $mode ) {
			$msgstr .= $unquote( $trimmed );
		}
	}
}
$flush();

// Nagłówek (msgid "") musi zostać — zawiera charset.
ksort( $entries );

$count   = count( $entries );
$ids     = '';
$strs    = '';
$id_tab  = array();
$str_tab = array();
foreach ( $entries as $id => $str ) {
	$id_tab[]  = array( strlen( $ids ), strlen( $id ) );
	$str_tab[] = array( strlen( $strs ), strlen( $str ) );
	$ids      .= $id . "\0";
	$strs     .= $str . "\0";
}

$key_start = 28 + 16 * $count;
$val_start = $key_start + strlen( $ids );

$mo = pack( 'Vvvvvvv', 0x950412de, 0, 0, 0, 0, 0, 0 );
// Nagłówek MO: magic, rewizja, liczba, offset tablicy id, offset tablicy str,
// rozmiar tablicy hash (0), offset hash (0).
$mo = pack( 'VVVVVVV', 0x950412de, 0, $count, 28, 28 + 8 * $count, 0, $key_start );
// Uwaga: hash pomijamy (offset wskazuje za tablice) — gettext czyta liniowo.

$table_ids  = '';
$table_strs = '';
foreach ( $id_tab as $i => $meta ) {
	$table_ids  .= pack( 'VV', $meta[1], $key_start + $meta[0] );
	$table_strs .= pack( 'VV', $str_tab[ $i ][1], $val_start + $str_tab[ $i ][0] );
}

$mo_path = preg_replace( '/\.po$/', '.mo', $po_path );
file_put_contents( $mo_path, $mo . $table_ids . $table_strs . $ids . $strs );
echo "OK: {$mo_path} ({$count} wpisów)\n";
