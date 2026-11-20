#!/bin/sh
# Creates or updates the CloudFormation stack "sai-console" from infra/aws/console.yaml.
# Run signed in as an admin (aws sso login --profile sai). Prints no secret values.
#   CONSOLE_URL=https://... scripts/aws/stack.sh   (once the console has its address: turns on the scheduler)
set -eu
export AWS_PROFILE="${AWS_PROFILE:-sai}" AWS_REGION="${AWS_REGION:-us-east-1}"
cd "$(dirname "$0")/../.."

VPC=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
# Default subnets, except us-east-1e (it lacks most current instance types).
SUBNETS=$(aws ec2 describe-subnets --filters Name=vpc-id,Values="$VPC" Name=default-for-az,Values=true \
  --query "Subnets[?AvailabilityZone!='us-east-1e'].SubnetId" --output text | tr '\t' ',')
OIDC=true
aws iam list-open-id-connect-providers --output text | grep -q token.actions.githubusercontent.com && OIDC=false
# Keep the provider if this stack already created it.
if aws cloudformation describe-stack-resource --stack-name sai-console --logical-resource-id GitHubOidcProvider >/dev/null 2>&1; then OIDC=true; fi
# Keep the console's address (and so the scheduler) unless a new one is given.
if [ -z "${CONSOLE_URL:-}" ]; then
  CONSOLE_URL=$(aws cloudformation describe-stacks --stack-name sai-console \
    --query "Stacks[0].Parameters[?ParameterKey=='ConsoleUrl'].ParameterValue" --output text 2>/dev/null || true)
  [ "$CONSOLE_URL" = None ] && CONSOLE_URL=
fi

aws cloudformation deploy \
  --stack-name sai-console \
  --template-file infra/aws/console.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides VpcId="$VPC" SubnetIds="$SUBNETS" CreateGitHubOidcProvider="$OIDC" GitHubRepo="sai-cto@42077112/sai-platform@1452250496" ConsoleUrl="${CONSOLE_URL:-}" \
  --tags project=sai-console

aws cloudformation describe-stacks --stack-name sai-console --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output text
