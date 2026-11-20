#!/bin/sh
# Sends one sample of each chosen HHMC email (HHMC Live's templates, made-up values) to one
# allow-listed address through Amazon SES (scripts/hhmc-import/send-samples.ts). At most 10.
#   scripts/aws/send-sample-emails.sh <address> <key,key,...>
# The address must be in EMAIL_ALLOWED_RECIPIENTS in .env.aws. Prints one line per email.
set -eu
. "$(dirname "$0")/lib.sh"
TO="${1:?usage: send-sample-emails.sh <address> <key,key,...>}"
KEYS="${2:?usage: send-sample-emails.sh <address> <key,key,...>}"
[ -f .env.aws ] || { echo "Missing .env.aws (plain settings). See docs/aws.md."; exit 1; }
set -a; . ./.env.aws; set +a

IMAGE=$(aws ecs describe-express-gateway-service \
  --service-arn "arn:aws:ecs:$AWS_REGION:$(aws sts get-caller-identity --query Account --output text):service/default/sai-console" \
  --query 'service.activeConfigurations[0].primaryContainer.image' --output text)
HOST=$(out DatabaseHost)
ensure_cluster
FAMILY=sai-hhmc-sample-emails
aws ecs register-task-definition --family "$FAMILY" \
  --requires-compatibilities FARGATE --network-mode awsvpc --cpu 512 --memory 1024 \
  --runtime-platform cpuArchitecture=ARM64,operatingSystemFamily=LINUX \
  --execution-role-arn "$(out TaskExecutionRoleArn)" --task-role-arn "$(out TaskRoleArn)" \
  --container-definitions "$(cat <<JSON
[{
  "name": "samples",
  "image": "$IMAGE",
  "user": "root",
  "essential": true,
  "environment": [{"name": "DB_HOST", "value": "$HOST"}, {"name": "EMAIL_PROVIDER", "value": "$EMAIL_PROVIDER"},
                  {"name": "EMAIL_FROM", "value": "$EMAIL_FROM"}, {"name": "EMAIL_ALLOWED_RECIPIENTS", "value": "$EMAIL_ALLOWED_RECIPIENTS"}],
  "secrets": [{"name": "DB_PASSWORD", "valueFrom": "$(out DatabaseOwnerSecretArn):password::"}],
  "command": ["sh", "-c", "set -e; node -e \"const e=process.env;const u=new URL('postgresql://x');u.hostname=e.DB_HOST;u.port='5432';u.username='sai_owner';u.password=e.DB_PASSWORD;u.pathname='/sai';u.searchParams.set('sslmode','verify-full');require('fs').writeFileSync('.env.pilot','DATABASE_OWNER_URL='+u+'\\\\n',{mode:0o600})\"; unset DB_PASSWORD; npx tsx scripts/hhmc-import/send-samples.ts --to \"\$SAMPLE_TO\" --keys \"\$SAMPLE_KEYS\" --confirm-host \"\$DB_HOST\"; rm -f .env.pilot"],
  "logConfiguration": {"logDriver": "awslogs", "options": {"awslogs-group": "$(out LogGroupName)", "awslogs-region": "$AWS_REGION", "awslogs-stream-prefix": "samples"}}
}]
JSON
)" >/dev/null

OVERRIDES=$(TO="$TO" KEYS="$KEYS" node -e 'process.stdout.write(JSON.stringify({containerOverrides:[{name:"samples",environment:[{name:"SAMPLE_TO",value:process.env.TO},{name:"SAMPLE_KEYS",value:process.env.KEYS}]}]}))')
TASK=$(aws ecs run-task --cluster default --launch-type FARGATE --task-definition "$FAMILY" \
  --network-configuration "awsvpcConfiguration={subnets=[$(subnets)],securityGroups=[$(out AppSecurityGroupId)],assignPublicIp=ENABLED}" \
  --overrides "$OVERRIDES" --query 'tasks[0].taskArn' --output text)
aws ecs wait tasks-stopped --cluster default --tasks "$TASK" || aws ecs wait tasks-stopped --cluster default --tasks "$TASK"
CODE=$(aws ecs describe-tasks --cluster default --tasks "$TASK" --query 'tasks[0].containers[0].exitCode' --output text)
aws logs get-log-events --log-group-name "$(out LogGroupName)" --log-stream-name "samples/samples/${TASK##*/}" \
  --start-from-head --query 'events[].message' --output text | tr '\t' '\n' | grep -v "npm notice"
[ "$CODE" = 0 ]
