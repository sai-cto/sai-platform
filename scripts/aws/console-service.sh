#!/bin/sh
# Creates the console's ECS Express service, or updates its settings (docs/aws.md).
#   scripts/aws/console-service.sh [image-tag]     (default tag: latest)
#
# Plain settings come from .env.aws (git-ignored; see docs/aws.md for the list). Secrets come from
# Secrets Manager by reference: their values never pass through this script.
set -eu
. "$(dirname "$0")/lib.sh"
cd "$(dirname "$0")/../.."
[ -f .env.aws ] || { echo "Missing .env.aws (plain settings). See docs/aws.md."; exit 1; }
set -a; . ./.env.aws; set +a

TAG="${1:-latest}"
IMAGE="$(out ImageRepositoryUri):$TAG"
SITE_URL=$(out SiteUrl)
ORIGINS="$SITE_URL${WEBSITE_INTAKE_ORIGINS_VERCEL:+,$WEBSITE_INTAKE_ORIGINS_VERCEL}${WEBSITE_INTAKE_ORIGINS_EXTRA:+,$WEBSITE_INTAKE_ORIGINS_EXTRA}"
EXISTING=$(aws ecs describe-services --cluster default --services sai-console \
  --query 'services[?status==`ACTIVE`].serviceArn' --output text 2>/dev/null || true)
APP_URL="${APP_URL:-}"

# Optional secrets: passed to the app only once they exist (scripts/aws/set-secret.sh).
secret_arn() { aws secretsmanager describe-secret --secret-id "sai/console/$1" --query ARN --output text 2>/dev/null || true; }
MAPS_SERVER=$(secret_arn google-maps-server-key); MAPS_BROWSER=$(secret_arn google-maps-browser-key)

CONTAINER=$(MAPS_SERVER="$MAPS_SERVER" MAPS_BROWSER="$MAPS_BROWSER" ORIGINS="$ORIGINS" IMAGE="$IMAGE" APP_URL="$APP_URL" DB_HOST="$(out DatabaseHost)" BUCKET="$(out UploadsBucketName)" \
  DB_SECRET="$(out DatabaseOwnerSecretArn)" LINK_SECRET="$(out LinkSigningSecretArn)" CRON_SECRET_ARN="$(out CronSecretArn)" \
  MS_SECRET="$(out MicrosoftClientSecretArn)" LOG_GROUP="$(out LogGroupName)" node -e '
const e = process.env;
const env = {
  NODE_ENV: "production", AWS_REGION: e.AWS_REGION,
  PILOT_MODE: e.PILOT_MODE, PILOT_ACCOUNTS: e.PILOT_ACCOUNTS,
  MICROSOFT_CLIENT_ID: e.MICROSOFT_CLIENT_ID, MICROSOFT_TENANT_ID: e.MICROSOFT_TENANT_ID,
  WEBSITE_INTAKE_ENVIRONMENT: e.WEBSITE_INTAKE_ENVIRONMENT, WEBSITE_INTAKE_ORIGINS: e.ORIGINS,
  DATABASE_POOL_MAX: e.DATABASE_POOL_MAX || "5",
  DB_HOST: e.DB_HOST, DB_NAME: "sai", DB_USER: "sai_owner",
  FILE_STORAGE_BUCKET: e.BUCKET, PORT: "3000",
  ...(e.APP_URL ? { APP_URL: e.APP_URL } : {}),
};
const secrets = [
  ["DB_PASSWORD", e.DB_SECRET + ":password::"],
  ["LINK_SIGNING_SECRET", e.LINK_SECRET],
  ["CRON_SECRET", e.CRON_SECRET_ARN],
  ["MICROSOFT_CLIENT_SECRET", e.MS_SECRET],
  ...(e.MAPS_SERVER ? [["GOOGLE_MAPS_API_KEY", e.MAPS_SERVER]] : []),
  ...(e.MAPS_BROWSER ? [["GOOGLE_MAPS_EMBED_KEY", e.MAPS_BROWSER]] : []),
];
process.stdout.write(JSON.stringify({
  image: e.IMAGE, containerPort: 3000,
  awsLogsConfiguration: { logGroup: e.LOG_GROUP, logStreamPrefix: "console" },
  environment: Object.entries(env).filter(([, v]) => v).map(([name, value]) => ({ name, value: String(value) })),
  secrets: secrets.map(([name, valueFrom]) => ({ name, valueFrom })),
}));
')

ensure_cluster
NETWORK="securityGroups=$(out AppSecurityGroupId),subnets=$(subnets)"
if [ -z "$EXISTING" ]; then
  aws ecs create-express-gateway-service --cluster default --service-name sai-console \
    --execution-role-arn "$(out TaskExecutionRoleArn)" --task-role-arn "$(out TaskRoleArn)" \
    --infrastructure-role-arn "$(out ExpressInfrastructureRoleArn)" \
    --health-check-path /api/health --cpu 512 --memory 1024 --cpu-architecture ARM64 \
    --scaling-target minTaskCount=1,maxTaskCount=2 \
    --network-configuration "$NETWORK" --primary-container "$CONTAINER" \
    --query 'service.[serviceArn,status.statusCode]' --output text
else
  aws ecs update-express-gateway-service --service-arn "$EXISTING" \
    --execution-role-arn "$(out TaskExecutionRoleArn)" --task-role-arn "$(out TaskRoleArn)" \
    --health-check-path /api/health --cpu 512 --memory 1024 \
    --scaling-target minTaskCount=1,maxTaskCount=2 \
    --network-configuration "$NETWORK" --primary-container "$CONTAINER" \
    --query 'service.[serviceArn,status.statusCode]' --output text
fi
