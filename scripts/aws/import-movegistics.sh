#!/bin/sh
# Loads the Movegistics exports into the AWS database's HHMC live data, with the same guarded
# "pilot" import as `npm run hhmc:import:pilot` (scripts/hhmc-import/index.ts --real --target pilot).
#   scripts/aws/import-movegistics.sh [path/to/data/movegistics]
#
# The database is private, so the exports go to the private transfer bucket and a one-off task
# (the console image, inside the VPC) runs the importer. The upload is deleted afterwards.
# Re-running after a fresh export updates records, never duplicates. Prints counts only.
set -eu
. "$(dirname "$0")/lib.sh"
DIR="${1:-data/movegistics}"
[ -d "$DIR" ] || { echo "No exports folder: $DIR"; exit 1; }

BUCKET=$(out TransferBucketName)
KEY="import/$(date -u +%Y%m%dT%H%M%SZ)-movegistics.tgz"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
COPYFILE_DISABLE=1 tar -czf "$TMP/m.tgz" --no-mac-metadata -C "$DIR" . 2>/dev/null || tar -czf "$TMP/m.tgz" -C "$DIR" .
aws s3 cp --only-show-errors --sse AES256 "$TMP/m.tgz" "s3://$BUCKET/$KEY"
URL=$(aws s3 presign "s3://$BUCKET/$KEY" --expires-in 900)
IMAGE=$(aws ecs describe-express-gateway-service \
  --service-arn "arn:aws:ecs:$AWS_REGION:$(aws sts get-caller-identity --query Account --output text):service/default/sai-console" \
  --query 'service.activeConfigurations[0].primaryContainer.image' --output text)
HOST=$(out DatabaseHost)

# The importer's own safety copy needs pg_dump, which the image doesn't have; an RDS snapshot
# taken first serves the same purpose (restore it into a new instance to undo the import).
SNAP="sai-console-before-import-$(date -u +%Y%m%d-%H%M%S)"
aws rds create-db-snapshot --db-instance-identifier sai-console --db-snapshot-identifier "$SNAP" >/dev/null
echo "Snapshot $SNAP: waiting for it to finish..."
aws rds wait db-snapshot-available --db-snapshot-identifier "$SNAP"

ensure_cluster
FAMILY=sai-movegistics-import
aws ecs register-task-definition --family "$FAMILY" \
  --requires-compatibilities FARGATE --network-mode awsvpc --cpu 1024 --memory 2048 \
  --runtime-platform cpuArchitecture=ARM64,operatingSystemFamily=LINUX \
  --execution-role-arn "$(out TaskExecutionRoleArn)" --task-role-arn "$(out TaskRoleArn)" \
  --container-definitions "$(cat <<JSON
[{
  "name": "import",
  "image": "$IMAGE",
  "user": "root",
  "essential": true,
  "environment": [{"name": "DB_HOST", "value": "$HOST"}],
  "secrets": [{"name": "DB_PASSWORD", "valueFrom": "$(out DatabaseOwnerSecretArn):password::"}],
  "command": ["sh", "-c", "set -e; mkdir -p data/movegistics; node -e \"fetch(process.env.EXPORTS_URL).then(r=>{if(!r.ok)throw new Error('download '+r.status);return r.arrayBuffer()}).then(b=>require('fs').writeFileSync('/tmp/m.tgz',Buffer.from(b)))\"; tar -xzf /tmp/m.tgz -C data/movegistics; node -e \"const e=process.env;const u=new URL('postgresql://x');u.hostname=e.DB_HOST;u.port='5432';u.username='sai_owner';u.password=e.DB_PASSWORD;u.pathname='/sai';u.searchParams.set('sslmode','verify-full');require('fs').writeFileSync('.env.pilot','DATABASE_OWNER_URL='+u+'\\\\n',{mode:0o600})\"; unset DB_PASSWORD; npx tsx scripts/hhmc-import/index.ts --real --target pilot --confirm-host \"\$DB_HOST\" --no-backup; rm -f .env.pilot"],
  "logConfiguration": {"logDriver": "awslogs", "options": {"awslogs-group": "$(out LogGroupName)", "awslogs-region": "$AWS_REGION", "awslogs-stream-prefix": "import"}}
}]
JSON
)" >/dev/null

TASK=$(aws ecs run-task --cluster default --launch-type FARGATE --task-definition "$FAMILY" \
  --network-configuration "awsvpcConfiguration={subnets=[$(subnets)],securityGroups=[$(out AppSecurityGroupId)],assignPublicIp=ENABLED}" \
  --overrides "{\"containerOverrides\":[{\"name\":\"import\",\"environment\":[{\"name\":\"EXPORTS_URL\",\"value\":\"$URL\"}]}]}" \
  --query 'tasks[0].taskArn' --output text)
echo "Import task started: ${TASK##*/}"
aws ecs wait tasks-stopped --cluster default --tasks "$TASK" || aws ecs wait tasks-stopped --cluster default --tasks "$TASK"
CODE=$(aws ecs describe-tasks --cluster default --tasks "$TASK" --query 'tasks[0].containers[0].exitCode' --output text)
aws logs get-log-events --log-group-name "$(out LogGroupName)" --log-stream-name "import/import/${TASK##*/}" \
  --query 'events[].message' --output text | tr '\t' '\n' | grep -v "npm notice"
aws s3 rm --only-show-errors "s3://$BUCKET/$KEY"
echo "Exit code: $CODE"
[ "$CODE" = 0 ]
