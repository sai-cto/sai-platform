#!/bin/sh
# Runs one READ-ONLY SQL query against the AWS database and prints the rows (columns split by |).
#   scripts/aws/query.sh "select count(*) from customers"
#
# The database is private, so this runs a one-off Fargate task (postgres:18 client, the console's
# security group) as the owner, inside a read-only transaction: writes are refused. Use it for
# checks and counts only; never select secrets or personal data you don't need.
set -eu
. "$(dirname "$0")/lib.sh"
SQL="${1:?usage: query.sh \"select ...\"}"

ensure_cluster
FAMILY=sai-db-query
aws ecs register-task-definition --family "$FAMILY" \
  --requires-compatibilities FARGATE --network-mode awsvpc --cpu 256 --memory 512 \
  --runtime-platform cpuArchitecture=ARM64,operatingSystemFamily=LINUX \
  --execution-role-arn "$(out TaskExecutionRoleArn)" \
  --container-definitions "$(cat <<JSON
[{
  "name": "query",
  "image": "public.ecr.aws/docker/library/postgres:18-alpine",
  "essential": true,
  "environment": [{"name": "PGHOST", "value": "$(out DatabaseHost)"}, {"name": "PGUSER", "value": "sai_owner"},
                  {"name": "PGDATABASE", "value": "sai"}, {"name": "PGSSLMODE", "value": "require"},
                  {"name": "PGOPTIONS", "value": "-c default_transaction_read_only=on"}],
  "secrets": [{"name": "PGPASSWORD", "valueFrom": "$(out DatabaseOwnerSecretArn):password::"}],
  "command": ["sh", "-c", "psql -v ON_ERROR_STOP=1 -A -F '|' -c \"\$SQL\""],
  "logConfiguration": {"logDriver": "awslogs", "options": {"awslogs-group": "$(out LogGroupName)", "awslogs-region": "$AWS_REGION", "awslogs-stream-prefix": "query"}}
}]
JSON
)" >/dev/null

OVERRIDES=$(SQL="$SQL" node -e 'process.stdout.write(JSON.stringify({containerOverrides:[{name:"query",environment:[{name:"SQL",value:process.env.SQL}]}]}))')
TASK=$(aws ecs run-task --cluster default --launch-type FARGATE --task-definition "$FAMILY" \
  --network-configuration "awsvpcConfiguration={subnets=[$(subnets)],securityGroups=[$(out AppSecurityGroupId)],assignPublicIp=ENABLED}" \
  --overrides "$OVERRIDES" --query 'tasks[0].taskArn' --output text)
aws ecs wait tasks-stopped --cluster default --tasks "$TASK" || aws ecs wait tasks-stopped --cluster default --tasks "$TASK"
CODE=$(aws ecs describe-tasks --cluster default --tasks "$TASK" --query 'tasks[0].containers[0].exitCode' --output text)
aws logs get-log-events --log-group-name "$(out LogGroupName)" --log-stream-name "query/query/${TASK##*/}" \
  --start-from-head --query 'events[].message' --output text | tr '\t' '\n'
[ "$CODE" = 0 ]
