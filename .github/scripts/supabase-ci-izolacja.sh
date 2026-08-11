#!/usr/bin/env bash
#
# Izolacja efemerycznego Supabase CI od WSPÓŁDZIELONEJ instancji deweloperskiej.
#
# KONTEKST (self-hosted runner `mac-pm`, decyzja właściciela 2026-08-11):
# CI biegnie na tym samym Macu, na którym działa współdzielony lokalny Supabase
# deweloperów (project_id "db", porty 54320-54329). Supabase CLI nazywa
# kontenery, wolumeny i sieć po `project_id` z config.toml — NIE po katalogu
# roboczym. Checkout CI niesie ten sam config.toml co ~/rental-platform, więc
# bez tej łatki `supabase start` w jobie podpiąłby się pod ISTNIEJĄCE kontenery
# dewelopera, a `supabase db reset` ZAORAŁBY współdzieloną bazę (znany incydent
# klasy „cudzy db reset zdejmuje twoją migrację").
#
# ŁATKA: project_id "db" → "db-ci" (osobne kontenery supabase_*_db-ci, osobne
# wolumeny i sieć) oraz porty 543xx → 563xx (osobny zakres; 563xx zweryfikowane
# jako wolne na mac-pm). `inspector_port` edge-runtime zostaje — kontener nie
# publikuje go na hosta, a edge-runtime i tak jest wyłączony w CI (patrz -x
# w workflow).
#
# Po łatce werdykt oddaje OSOBNA sonda (supabase-ci-sonda-izolacji.sh) —
# rozdzielenie jest celowe: gdy ktoś zdejmie krok łatki, sonda w workflow
# nadal płonie, zanim cokolwiek dotknie Dockera.
set -euo pipefail

CONFIG="packages/db/supabase/config.toml"
[ -f "$CONFIG" ] || { echo "BŁĄD: brak $CONFIG (skrypt woła się z korzenia repo)"; exit 1; }

sed -E -i.ci-izolacja.bak \
  -e 's/^project_id = "db"$/project_id = "db-ci"/' \
  -e 's/^(port|shadow_port) = 543([0-9]{2})$/\1 = 563\2/' \
  "$CONFIG"
rm -f "$CONFIG.ci-izolacja.bak"

echo "Config po łatce izolacji:"
grep -nE '^(project_id|port|shadow_port) = ' "$CONFIG"
