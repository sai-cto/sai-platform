# SAI Console on AWS (ECS Fargate, docs/aws.md). Built and pushed by .github/workflows/deploy-aws.yml.
# Nothing secret is baked in: every setting arrives as an environment variable or an ECS secret.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    # Amazon RDS's certificate authorities, so the database certificate is verified (verify-full).
    NODE_EXTRA_CA_CERTS=/etc/ssl/rds-global-bundle.pem

WORKDIR /app

ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/rds-global-bundle.pem
RUN chmod 644 /etc/ssl/rds-global-bundle.pem

COPY package.json package-lock.json ./
# Dev dependencies stay: the start script runs the TypeScript prepare step (migrations) with tsx.
RUN npm ci --include=dev --ignore-scripts && npm cache clean --force

COPY . .
RUN npx next build

RUN chown -R node:node /app/.next
USER node
EXPOSE 3000
CMD ["sh", "scripts/aws/start.sh"]
