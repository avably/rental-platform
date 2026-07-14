#!/usr/bin/env bash
set -euo pipefail
ALLOW='NEXT_PUBLIC_(SUPABASE_URL|SUPABASE_ANON_KEY|SITE_URL|TURNSTILE_SITE_KEY)'
HITS=$(grep -rhoE 'NEXT_PUBLIC_[A-Z_0-9]+' apps packages --include='*.ts' --include='*.tsx' | sort -u | grep -vE "$ALLOW" || true)
if [ -n "$HITS" ]; then echo "Niedozwolone zmienne publiczne:"; echo "$HITS"; exit 1; fi
