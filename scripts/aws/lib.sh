#!/bin/sh
# Shared helpers for scripts/aws/*.sh. Source it; prints no secret values.
export AWS_PROFILE="${AWS_PROFILE:-sai}" AWS_REGION="${AWS_REGION:-us-east-1}" AWS_PAGER=""

# out NAME: one output of the sai-console stack.
out() {
  aws cloudformation describe-stacks --stack-name sai-console \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

# Default-VPC subnets the tasks run in (comma-separated), us-east-1e excluded.
subnets() {
  vpc=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
  aws ec2 describe-subnets --filters Name=vpc-id,Values="$vpc" Name=default-for-az,Values=true \
    --query "Subnets[?AvailabilityZone!='us-east-1e'].SubnetId" --output text | tr '\t' ','
}

ensure_cluster() {
  aws ecs describe-clusters --clusters default --query 'clusters[?status==`ACTIVE`].clusterName' --output text | grep -q default \
    || aws ecs create-cluster --cluster-name default >/dev/null
}
