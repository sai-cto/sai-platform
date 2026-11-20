#!/bin/sh
# Loads a plain-SQL database dump (gzipped) into the AWS database, from inside the VPC.
#   scripts/aws/restore-db.sh path/to/dump.sql.gz
#
# The database is not reachable from the internet, so this uploads the file to the private
# transfer bucket and runs a one-off Fargate task (postgres:18 client, the console's security
# group) that downloads it through a 15-minute link and loads it with ON_ERROR_STOP. It refuses a
# database that already has tables. Prepare the dump first (docs/aws.md, "Moving the data").
set -eu
. "$(dirname "$0")/lib.sh"
FILE="${1:?usage: restore-db.sh dump.sql.gz}"

BUCKET=$(out TransferBucketName)
KEY="restore/$(date -u +%Y%m%dT%H%M%SZ)-$(basename "$FILE")"
aws s3 cp --only-show-errors --sse AES256 "$FILE" "s3://$BUCKET/$KEY"
URL=$(aws s3 presign "s3://$BUCKET/$KEY" --expires-in 900)

ensure_cluster
FAMILY=sai-db-restore
aws ecs register-task-definition --family "$FAMILY" \
  --requires-compatibilities FARGATE --network-mode awsvpc --cpu 512 --memory 1024 \
  --runtime-platform cpuArchitecture=ARM64,operatingSystemFamily=LINUX \
  --execution-role-arn "$(out TaskExecutionRoleArn)" \
  --container-definitions "$(cat <<JSON
[{
  "name": "restore",
  "image": "public.ecr.aws/docker/library/postgres:18-alpine",
  "essential": true,
  "environment": [{"name": "PGHOST", "value": "$(out DatabaseHost)"}, {"name": "PGUSER", "value": "sai_owner"},
                  {"name": "PGDATABASE", "value": "sai"}, {"name": "PGSSLMODE", "value": "require"}],
  "secrets": [{"name": "PGPASSWORD", "valueFrom": "$(out DatabaseOwnerSecretArn):password::"}],
  "command": ["sh", "-c", "set -e; n=\$(psql -Atc \"select count(*) from pg_tables where schemaname='public'\"); if [ \"\$n\" != 0 ]; then echo 'REFUSED: the database already has tables'; exit 3; fi; psql -qc \"do \$\$ begin if not exists (select 1 from pg_roles where rolname='sai_app') then create role sai_app login nobypassrls nocreatedb nocreaterole; end if; end \$\$\"; wget -qO /tmp/dump.sql.gz \"\$DUMP_URL\"; gunzip /tmp/dump.sql.gz; psql -v ON_ERROR_STOP=1 -q -f /tmp/dump.sql > /dev/null; echo RESTORE_OK; psql -Atc \"select 'customers '||(select count(*) from customers)||', leads '||(select count(*) from hhmc_leads)||', jobs '||(select count(*) from hhmc_jobs)||', estimates '||(select count(*) from hhmc_estimates)||', invoices '||(select count(*) from hhmc_invoices)||', payments '||(select count(*) from payments)||', users '||(select count(*) from users)\""],
  "logConfiguration": {"logDriver": "awslogs", "options": {"awslogs-group": "$(out LogGroupName)", "awslogs-region": "$AWS_REGION", "awslogs-stream-prefix": "restore"}}
}]
JSON
)" >/dev/null

TASK=$(aws ecs run-task --cluster default --launch-type FARGATE --task-definition "$FAMILY" \
  --network-configuration "awsvpcConfiguration={subnets=[$(subnets)],securityGroups=[$(out AppSecurityGroupId)],assignPublicIp=ENABLED}" \
  --overrides "{\"containerOverrides\":[{\"name\":\"restore\",\"environment\":[{\"name\":\"DUMP_URL\",\"value\":\"$URL\"}]}]}" \
  --query 'tasks[0].taskArn' --output text)
echo "Restore task started: ${TASK##*/}"
aws ecs wait tasks-stopped --cluster default --tasks "$TASK"
CODE=$(aws ecs describe-tasks --cluster default --tasks "$TASK" --query 'tasks[0].containers[0].exitCode' --output text)
aws logs get-log-events --log-group-name "$(out LogGroupName)" --log-stream-name "restore/restore/${TASK##*/}" \
  --query 'events[].message' --output text | tr '\t' '\n'
aws s3 rm --only-show-errors "s3://$BUCKET/$KEY"
echo "Exit code: $CODE"
[ "$CODE" = 0 ]
