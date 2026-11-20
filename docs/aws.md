# Running on AWS

The SAI Console and the Hired Hands website run on AWS in account `960129066398`, region
`us-east-1` (N. Virginia). This replaced Vercel + Neon in November 2026.

- SAI Console: <https://sa-c95d7b62b8154ff2a92f661e2c28a8a2.ecs.us-east-1.on.aws>
- Hired Hands website: <https://d19nd4qfh33bnj.cloudfront.net> (the deploy points its quote form at the
  AWS console; the file in the repository keeps the Vercel address until Vercel is switched off)
- Microsoft sign-in redirect URI (registered in Entra):
  `https://sa-c95d7b62b8154ff2a92f661e2c28a8a2.ecs.us-east-1.on.aws/api/auth/microsoft/callback`

| What | Where |
| --- | --- |
| SAI Console | ECS Express Mode service `sai-console` (Fargate, ARM, 0.5 vCPU / 1 GB) behind its load balancer |
| Database | RDS PostgreSQL 18 `sai-console` (db.t4g.micro, 20 GB gp3, encrypted, 7-day backups, not public) |
| Uploaded files | S3 bucket `sai-console-files-960129066398` (private, encrypted, versioned) |
| Secrets | Secrets Manager `sai/console/*` |
| Scheduler | EventBridge rule `sai-console-daily` (every 15 minutes, despite its name) → `/api/cron/scheduled` |
| Website | S3 bucket `hiredhands-site-960129066398` + CloudFront |
| Deploys | GitHub Actions `.github/workflows/deploy-aws.yml` on every push to `main` |
| Everything above | CloudFormation stack `sai-console` from `infra/aws/console.yaml` |

## Why these services

Requirements: server-rendered Next.js 16, automatic deploys from `main`, a database that is not
reachable from the internet, low cost at our size, and simple enough for a student team.

- **App Runner**: closed to new customers since 30 April 2026. Not an option.
- **Amplify Hosting**: good for static sites, and it runs the website-style part of Next.js, but
  its server-side compute cannot join a VPC. The database would have to be public. Rejected for
  the console; we don't need it for the website either (plain S3 + CloudFront is simpler).
- **ECS Fargate (Express Mode)**: AWS's replacement for App Runner. One command creates the
  service, the HTTPS load balancer, its address and autoscaling. Tasks run inside our VPC, so
  the database stays private. Chosen.
- **Lightsail containers + database**: about half the price, but PostgreSQL only up to 16 (we
  run 18) and no documented private path from containers to the database. Rejected.
- **Database: RDS PostgreSQL vs Aurora Serverless v2**: Aurora's minimum capacity costs more than
  a db.t4g.micro at our size, and we don't need its scaling. RDS chosen, same major version (18)
  as Neon.

## Monthly cost (estimate, us-east-1)

| Item | ~$/month |
| --- | --- |
| Load balancer (ALB) + its public IPv4 addresses | 23 |
| Fargate task, ARM 0.5 vCPU / 1 GB, always on + public IPv4 | 18 |
| RDS db.t4g.micro + 20 GB gp3 (backups up to 20 GB are free) | 15 |
| Secrets Manager (4 secrets), CloudWatch logs, ECR, S3, CloudFront, EventBridge | 3 |
| **Total** | **~55-60** |

A budget alert in AWS Budgets emails the CTO address above $50/month.

## How it fits together

- The app connects to the database as `sai_app` (row-level security applies). Migrations run as
  the owner `sai_owner`. On every start the container (`scripts/aws/start.sh`) builds the owner
  address from the `sai/console/database-owner` secret, runs `scripts/demo-prepare.ts`
  (app role, migrations, pilot accounts) and starts Next.js.
- The database only accepts connections from the console's security group. To run a one-off
  job against it, run it as an ECS task with that security group. Two such jobs are scripted:
  - `scripts/aws/restore-db.sh <dump.sql.gz>`: loads a plain-SQL dump into an empty database.
  - `scripts/aws/import-movegistics.sh [data/movegistics]`: the guarded Movegistics import
    (same as `npm run hhmc:import:pilot`), run with the console image. Safe to re-run.
  - `scripts/aws/query.sh "select ..."`: one read-only query (writes are refused), for checks.
  Both upload their input to the private transfer bucket, use a 15-minute link, and delete it.
- The certificate of the database is verified (`sslmode=verify-full`, Amazon RDS CA bundle in
  the image).

## Settings

Plain settings are in the service definition; secrets come from Secrets Manager. Never put a
secret value in a file in this repository.

| Name | Source |
| --- | --- |
| `PILOT_MODE`, `PILOT_ACCOUNTS`, `APP_URL` | service settings |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_TENANT_ID` | service settings |
| `MICROSOFT_CLIENT_SECRET` | secret `sai/console/microsoft-client-secret` |
| `LINK_SIGNING_SECRET` | secret `sai/console/link-signing-secret` |
| `CRON_SECRET` | secret `sai/console/cron-secret` |
| `DB_PASSWORD` (owner) | secret `sai/console/database-owner` |
| `DB_HOST`, `DB_NAME`, `DB_USER` | service settings |
| `FILE_STORAGE_BUCKET` | service settings |
| `WEBSITE_INTAKE_ORIGINS`, `WEBSITE_INTAKE_ENVIRONMENT` | service settings |
| `DATABASE_POOL_MAX` | service settings |
| `EMAIL_PROVIDER` (`ses`), `EMAIL_FROM`, `EMAIL_ALLOWED_RECIPIENTS` | service settings (docs/hhmc-emails.md) |
| `GOOGLE_MAPS_API_KEY` (server), `GOOGLE_MAPS_EMBED_KEY` (browser) | secrets `sai/console/google-maps-server-key`, `sai/console/google-maps-browser-key` (optional) |

To change a secret: `scripts/aws/set-secret.sh <name>` (it reads the value from your keyboard,
never from the command line), then redeploy.

## Signing in to AWS

Nobody uses the root user day to day. Sign in at the AWS access portal
<https://d-90666767f8.awsapps.com/start> as `cto-admin` (MFA required), or on the command line:

```bash
aws sso login --profile sai
```

## Deploying

Push to `main`. GitHub Actions builds the image, pushes it to ECR and updates the service; then it
uploads `hiredhands-site/` to S3 and clears CloudFront's cache. GitHub signs in to AWS with a
short-lived OIDC token; the role `sai-github-deploy` only accepts `main` of `sai-cto/sai-platform`.

To change the infrastructure, edit `infra/aws/console.yaml` and run `scripts/aws/stack.sh`.

## Backups and restores

- RDS keeps automated backups for 7 days (restore to any second in that window from the RDS
  console: *Restore to point in time*, into a new instance).
- Deleting the stack would keep a final snapshot of the database and keep the files bucket and
  secrets.
- For a portable copy, take a manual snapshot in the RDS console (*Actions → Take snapshot*).

## Moving from Vercel + Neon (November 2026)

1. The Neon database was dumped (`pg_dump`), restored into RDS with `scripts/aws/restore-db.sh`
   (row counts matched exactly), then the Movegistics history was imported with
   `scripts/aws/import-movegistics.sh`.
2. Vercel and Neon were left running and unchanged until AWS was confirmed working.
3. Anything entered on the Vercel console after the dump is not in AWS. If that happened, take a
   fresh Neon dump and restore it into a new, empty database before switching people over (the
   restore refuses a database that already has tables).
4. `LINK_SIGNING_SECRET` and `MICROSOFT_CLIENT_SECRET` could not be read back from Vercel. A new
   link secret was generated (estimate links sent from Vercel stop working; there were none
   outstanding), and the Microsoft secret must be a new client secret from Entra
   (`scripts/aws/set-secret.sh microsoft-client-secret`, then redeploy).
