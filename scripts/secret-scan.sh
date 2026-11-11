#!/usr/bin/env bash
# Fails if anything that looks like a live credential OR real personal data is in files git
# would commit. Usage: npm run secret-scan. Run before every commit. Exit code 1 = something found.
# Prints file:line only, never the matched value.
#
# Personal data rule (Phase 5C, real HHMC data): committed files may only contain
#   - email addresses at reserved test domains: example.com / .org / .net, anything ending in
#     .example, .test, .invalid or .localhost (RFC 2606 / 6761);
#   - North American phone numbers in the fictional 555 exchange (e.g. 607-555-0101).
# Anything else is treated as possibly real and fails the scan. Real data lives outside the
# repo (~/Documents/SAI/hhmc-data/), and import output folders are git-ignored.
set -uo pipefail
cd "$(dirname "$0")/.."
PATTERNS='sk_live_[0-9A-Za-z]+|rk_live_[0-9A-Za-z]+|pk_live_[0-9A-Za-z]+|whsec_[0-9A-Za-z]{8,}|sk_test_[0-9A-Za-z]{10,}|-----BEGIN ([A-Z]+ )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|ghp_[0-9A-Za-z]{30,}|github_pat_[0-9A-Za-z_]{30,}|xox[baprs]-[0-9A-Za-z-]{10,}|AIza[0-9A-Za-z_-]{35}|00D[0-9A-Za-z]{12,15}![0-9A-Za-z._]{20,}'
FILES=$(git ls-files --cached --others --exclude-standard)
BAD_ENV=$(echo "$FILES" | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$' || true)
HITS=$(echo "$FILES" | tr '\n' '\0' | xargs -0 -r grep -InE "$PATTERNS" 2>/dev/null || true)

# Real-data folders must never be tracked, whatever their contents.
BAD_DATA=$(echo "$FILES" | grep -E '(^|/)(hhmc-data|import-output|\.import)/' || true)

# Personal data. The lock file holds only package metadata; this script names the patterns.
PII_FILES=$(echo "$FILES" | grep -vE '^package-lock\.json$|^scripts/secret-scan\.sh$' || true)
EMAIL='[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}'
SAFE_EMAIL='@([A-Za-z0-9-]+\.)*(example\.(com|org|net)|[A-Za-z0-9-]*\.?example|[A-Za-z0-9-]+\.(test|invalid|localhost))$'
PHONE='\(?\b[2-9][0-9]{2}\)?[-. ][0-9]{3}[-. ][0-9]{4}\b'
SAFE_PHONE='^\(?[2-9][0-9]{2}\)?[-. ]555[-. ][0-9]{4}$'
PII=""
while IFS= read -r line; do
  [ -z "$line" ] && continue
  loc=${line%%:*}; rest=${line#*:}; ln=${rest%%:*}; text=${rest#*:}
  for m in $(printf '%s\n' "$text" | grep -oE "$EMAIL" | grep -viE "$SAFE_EMAIL"); do PII+="$loc:$ln (email)"$'\n'; done
  for m in $(printf '%s\n' "$text" | grep -oE "$PHONE" | tr ' ' '_' ); do
    printf '%s\n' "${m//_/ }" | grep -qE "$SAFE_PHONE" || PII+="$loc:$ln (phone)"$'\n'
  done
done < <(echo "$PII_FILES" | tr '\n' '\0' | xargs -0 -r grep -InE "$EMAIL|$PHONE" 2>/dev/null || true)
PII=$(printf '%s' "$PII" | sort -u)

if [ -n "$BAD_ENV" ] || [ -n "$HITS" ] || [ -n "$BAD_DATA" ] || [ -n "$PII" ]; then
  echo "POSSIBLE SECRETS OR PERSONAL DATA FOUND - do not commit:"
  [ -n "$BAD_ENV" ] && echo "$BAD_ENV" | sed 's/^/  env file tracked: /'
  [ -n "$HITS" ] && echo "$HITS" | cut -d: -f1,2 | sort -u | sed 's/^/  credential: /'
  [ -n "$BAD_DATA" ] && echo "$BAD_DATA" | sed 's/^/  real-data folder tracked: /'
  [ -n "$PII" ] && echo "$PII" | sed 's/^/  personal data: /'
  exit 1
fi
echo "Secret and personal-data scan: clean ($(echo "$FILES" | grep -c .) files)."
