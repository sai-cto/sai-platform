#!/usr/bin/env bash
# Fails if anything that looks like a live credential is in files git would commit.
# Usage: npm run secret-scan. Run before every commit. Exit code 1 = something found.
# Prints file:line only, never the matched value.
set -uo pipefail
cd "$(dirname "$0")/.."
PATTERNS='sk_live_[0-9A-Za-z]+|rk_live_[0-9A-Za-z]+|pk_live_[0-9A-Za-z]+|whsec_[0-9A-Za-z]{8,}|sk_test_[0-9A-Za-z]{10,}|-----BEGIN ([A-Z]+ )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|ghp_[0-9A-Za-z]{30,}|github_pat_[0-9A-Za-z_]{30,}|xox[baprs]-[0-9A-Za-z-]{10,}|AIza[0-9A-Za-z_-]{35}|00D[0-9A-Za-z]{12,15}![0-9A-Za-z._]{20,}'
FILES=$(git ls-files --cached --others --exclude-standard)
BAD_ENV=$(echo "$FILES" | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$' || true)
HITS=$(echo "$FILES" | tr '\n' '\0' | xargs -0 -r grep -InE "$PATTERNS" 2>/dev/null || true)
if [ -n "$BAD_ENV" ] || [ -n "$HITS" ]; then
  echo "POSSIBLE SECRETS FOUND - do not commit:"
  [ -n "$BAD_ENV" ] && echo "$BAD_ENV" | sed 's/^/  env file tracked: /'
  [ -n "$HITS" ] && echo "$HITS" | cut -d: -f1,2 | sort -u | sed 's/^/  /'
  exit 1
fi
echo "Secret scan: clean ($(echo "$FILES" | grep -c .) files)."
