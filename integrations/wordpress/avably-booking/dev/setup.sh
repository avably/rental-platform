#!/bin/sh
# Provisioning żywej instalacji (po `docker compose -f dev/docker-compose.yml up -d`):
# WordPress + polski locale + motyw Astra + WP Super Cache (włączony)
# + strona „Wypożyczalnia" z blokiem Avably Booking.
#
# Użycie: dev/setup.sh  (idempotentny)
set -eu

cd "$(dirname "$0")"

WP="docker compose -f docker-compose.yml run --rm cli"

echo "== Czekam na WordPressa =="
i=0
until ${WP} core is-installed >/dev/null 2>&1 || ${WP} core version >/dev/null 2>&1; do
	i=$((i+1)); [ $i -gt 30 ] && { echo "WordPress nie wstał"; exit 1; }
	sleep 2
done

if ! ${WP} core is-installed >/dev/null 2>&1; then
	echo "== Instaluję WordPressa =="
	${WP} core install \
		--url="http://localhost:8090" \
		--title="Wypożyczalnia Testowa" \
		--admin_user="admin" \
		--admin_password="avably-local-admin" \
		--admin_email="admin@example.test" \
		--skip-email
fi

echo "== Język polski =="
${WP} language core install pl_PL --activate || true

echo "== Motyw (Astra — popularny darmowy) =="
${WP} theme install astra --activate || true

echo "== Wtyczka cache (WP Super Cache) =="
${WP} plugin install wp-super-cache --activate || true
${WP} eval 'if ( function_exists("wp_cache_enable") ) { wp_cache_enable(); echo "cache ON\n"; }' || true

echo "== Aktywacja Avably Booking =="
${WP} plugin activate avably-booking

echo "== Ładne permalinki (admin-ajax nie wymaga, ale strony tak) =="
${WP} rewrite structure '/%postname%/' --hard || true

echo "== Strona z blokiem Avably Booking =="
if ! ${WP} post list --post_type=page --field=post_name | grep -qx "wypozyczalnia"; then
	${WP} post create \
		--post_type=page \
		--post_status=publish \
		--post_name="wypozyczalnia" \
		--post_title="Wypożyczalnia" \
		--post_content='<!-- wp:avably/booking /-->'
fi

echo
echo "Gotowe:"
echo "  Strona:   http://localhost:8090/wypozyczalnia/"
echo "  WP-Admin: http://localhost:8090/wp-admin (admin / avably-local-admin)"
echo "  Ustawienia wtyczki: Ustawienia -> Avably Booking (URL API + klucz avbl_…)"
