#!/bin/sh
# Starts the SAI Console in its AWS container (docs/aws.md).
#
# ECS hands the database owner's password in as DB_PASSWORD (from the RDS-managed secret), and
# the host, port, name and user as plain settings. This script builds DATABASE_OWNER_URL from
# them (certificate verified), prepares the database (app role sai_app, migrations, pilot
# accounts: scripts/demo-prepare.ts) and starts the server. Nothing is printed except steps.
set -eu

if [ -z "${DATABASE_OWNER_URL:-}" ]; then
  : "${DB_HOST:?DB_HOST is not set}" "${DB_PASSWORD:?DB_PASSWORD is not set}"
  DATABASE_OWNER_URL=$(node -e '
    const e = process.env;
    const u = new URL("postgresql://localhost");
    u.hostname = e.DB_HOST;
    u.port = e.DB_PORT || "5432";
    u.username = e.DB_USER || "sai_owner";
    u.password = e.DB_PASSWORD;
    u.pathname = "/" + (e.DB_NAME || "sai");
    u.searchParams.set("sslmode", "verify-full");
    process.stdout.write(u.toString());
  ')
  export DATABASE_OWNER_URL
fi
unset DB_PASSWORD

echo "Preparing the database..."
npx tsx scripts/demo-prepare.ts

echo "Starting the SAI Console on port ${PORT:-3000}..."
exec npx next start -H 0.0.0.0 -p "${PORT:-3000}"
