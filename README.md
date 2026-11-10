# SAI Platform

One proprietary software platform for Student Agencies Inc. (SAI) and its nine student-run businesses.

- **SAI Console** — a single web app where the tech team sees, manages, tests and changes every business's software.
- **Shared core** — login, users, roles, customers, payments, scheduling, notifications, files, the activity log and analytics.
- **Business modules** — one per business, built on the core, with each business's data kept strictly separate.

## Status

Planning (Phase 0). No application code yet. Setup instructions will be added here with the first runnable phase.

## Rules for this repository

- This repository is public. Never commit credentials, API keys or real customer data.
- Secrets live in `.env.local` (git-ignored). Only variable *names* go in `.env.example`.
