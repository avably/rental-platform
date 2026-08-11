#!/usr/bin/env bash
#
# Sonda izolacji — pali job, ZANIM cokolwiek dotknie Dockera, jeśli config
# Supabase nadal wskazuje instancję WSPÓŁDZIELONĄ na mac-pm (project_id "db"
# lub którykolwiek port 543xx). Patrz nagłówek supabase-ci-izolacja.sh.
#
# Mutacja kontrolna: zdjęcie kroku łatki izolacji z workflow → ta sonda
# kończy się czerwono (dowód w PR wdrażającym self-hosted CI).
set -euo pipefail

CONFIG="packages/db/supabase/config.toml"
[ -f "$CONFIG" ] || { echo "SONDA: brak $CONFIG"; exit 1; }

FAIL=0
if grep -qE '^project_id = "db"$' "$CONFIG"; then
  echo 'SONDA: project_id = "db" — kolizja nazw kontenerów/wolumenów ze współdzielonym Supabase.'
  FAIL=1
fi
if grep -qE '^(port|shadow_port) = 543[0-9]{2}$' "$CONFIG"; then
  echo "SONDA: porty 543xx — kolizja portów ze współdzielonym Supabase:"
  grep -nE '^(port|shadow_port) = 543[0-9]{2}$' "$CONFIG"
  FAIL=1
fi

if [ "$FAIL" -ne 0 ]; then
  echo "SONDA: STOP — uruchom .github/scripts/supabase-ci-izolacja.sh przed 'supabase start'."
  exit 1
fi

echo "SONDA: izolacja OK — $(grep -E '^project_id = ' "$CONFIG")"
grep -nE '^(port|shadow_port) = ' "$CONFIG"
