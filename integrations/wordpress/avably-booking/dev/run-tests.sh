#!/bin/sh
# Testy jednostkowe wtyczki — jedna komenda, bez PHP na hoście.
# Wymaga Dockera. PHPUnit 10 (phar) jest pobierany raz i cache'owany.
set -eu

cd "$(dirname "$0")/.."

PHPUNIT_VERSION="10.5.38"
CACHE_DIR="dev/.cache"
PHPUNIT_PHAR="${CACHE_DIR}/phpunit-${PHPUNIT_VERSION}.phar"

if [ ! -f "${PHPUNIT_PHAR}" ]; then
	mkdir -p "${CACHE_DIR}"
	echo "Pobieram PHPUnit ${PHPUNIT_VERSION}…"
	curl -fsSL -o "${PHPUNIT_PHAR}" "https://phar.phpunit.de/phpunit-${PHPUNIT_VERSION}.phar"
fi

exec docker run --rm \
	-v "$(pwd)":/app \
	-w /app \
	php:8.1-cli \
	php "${PHPUNIT_PHAR}" -c phpunit.xml.dist "$@"
