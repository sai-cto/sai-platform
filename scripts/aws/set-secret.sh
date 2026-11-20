#!/bin/sh
# Puts a new value into one of the console's secrets, read from the keyboard without echoing it
# (never pass a secret on the command line: it would land in your shell history).
#   scripts/aws/set-secret.sh microsoft-client-secret
# Then restart the console so it picks the value up: scripts/aws/console-service.sh
set -eu
. "$(dirname "$0")/lib.sh"
NAME="${1:?usage: set-secret.sh microsoft-client-secret|link-signing-secret|cron-secret}"
case "$NAME" in
  microsoft-client-secret|link-signing-secret|cron-secret) ;;
  *) echo "Unknown secret: $NAME"; exit 1 ;;
esac
printf 'Paste the value for sai/console/%s, then press Return: ' "$NAME"
stty -echo; IFS= read -r VALUE; stty echo; echo
[ -n "$VALUE" ] || { echo "Empty value: nothing changed."; exit 1; }
FILE=$(mktemp); trap 'rm -f "$FILE"' EXIT; chmod 600 "$FILE"
printf '%s' "$VALUE" > "$FILE"; unset VALUE
aws secretsmanager put-secret-value --secret-id "sai/console/$NAME" --secret-string "file://$FILE" --query VersionId --output text >/dev/null
echo "Saved sai/console/$NAME."
