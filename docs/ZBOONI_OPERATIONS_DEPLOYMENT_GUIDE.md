# Zbooni Lead Flood

## Internal Operations and Deployment Guide

This guide explains how Zbooni can operate, manage, and deploy the Lead Flood
system internally. It is not primarily a guide for day-to-day app usage.
Instead, it focuses on the operational systems behind the app: source code,
database, backend runtime, worker runtime, frontend deployment, environment
variables, staging, production deployment, and release checks.

No secret values are included in this document.

---

## System Model

The system is made up of four main platforms.

| System | Purpose |
| --- | --- |
| GitHub | Source code and deployment workflow. Repository: `Zbooni/zbooni-lead-flood`. |
| Supabase | Database, authentication, and operational state. Production project ref: `cbcgrzvqidtrtrtnzlso`. |
| Railway | Backend API and background worker runtime. Project: `9349f31f-3195-4778-9a7a-71b229fdb67d`. Services: `lead-flood-api` and `lead-flood-worker`. |
| Vercel | Frontend web app. Current URL: <https://zbooni-lead-flood.vercel.app>. |

---

## Operating Principle: GUI vs CLI

Zbooni can operate the system through the platform GUIs or through command-line
workflows.

The GUIs are best for ownership transfer, visual inspection, environment
variable management, logs, deployment history, domains, and management demos.
Supabase, Railway, Vercel, and GitHub all provide dashboards that are
appropriate for normal operational visibility.

The CLI and GitHub Actions workflow are better for deployments, database
migrations, repeatable release checks, and auditability. Production changes
should generally go through GitHub Actions or an equivalent controlled release
process rather than one-off manual changes.

For database schema changes, use committed migration files in
`supabase/migrations` rather than manually editing production through the
Supabase SQL Editor. The SQL Editor is useful for inspection or emergency
one-off work, but it should not be the default deployment path.

---

## Current Deployment Summary

At the time of this handoff, GitHub Actions is the main controlled deployment
path for the backend and database.

- Running the GitHub **production** deploy workflow updates Supabase schema
  migrations and deploys the Railway API and Railway worker.
- The production workflow does **not currently deploy Vercel** directly.
- Vercel frontend changes are currently deployed through the Vercel CLI/manual
  deployment path because the Vercel project is not yet connected to the
  Zbooni GitHub repository.
- Once Vercel is connected to `Zbooni/zbooni-lead-flood`, pushes to the
  configured production branch, usually `main`, can automatically trigger
  Vercel production frontend deployments.
- If Zbooni wants Vercel to wait for successful checks before deploying, the
  cleaner long-term setup is to deploy Vercel from GitHub Actions after
  CI/deployment checks pass, or configure Vercel's Git/build settings to gate
  or skip deployments until the required checks have passed.

In practice, the current production release model is:

```text
GitHub production workflow -> Supabase migrations + Railway API + Railway worker
```

And separately, until GitHub is connected to Vercel:

```text
Vercel CLI/manual deploy -> frontend web app
```

---

## Repository and Local Development Setup

This section covers the local repository checkout and validation commands.
These commands should be run from an approved development machine,
administrator workstation, or CI runner with access to the Zbooni GitHub
repository.

The repository root is the directory that contains the monorepo files,
including `package.json`, `pnpm-lock.yaml`, `apps/`, `packages/`, and
`supabase/`.

### Repository Commands

| Command | What it does |
| --- | --- |
| `git clone git@github.com:Zbooni/zbooni-lead-flood.git` | Clones the Zbooni repository onto an approved machine when the repository is not already present. |
| `cd zbooni-lead-flood` | Moves into the newly cloned repository root. |
| `cd <repo-checkout-path>` | Moves into an existing local checkout of the repository. Replace the placeholder with the actual checkout path. |
| `git status` | Shows whether the working tree is clean, modified, or has untracked files. Use this before deployment. |
| `git remote -v` | Shows the configured Git remotes. Confirm that `origin` points to the Zbooni repository. |
| `git branch --show-current` | Shows the active branch. Production deployment should normally be done from `main`. |
| `git log --oneline -5` | Shows the five most recent commits so the operator can confirm what code is currently checked out. |
| `pnpm install --frozen-lockfile` | Installs dependencies exactly from the lockfile. This avoids accidental dependency drift during validation or deployment. |
| `pnpm typecheck` | Runs TypeScript type checks across the project. |
| `pnpm lint` | Runs linting checks. |
| `pnpm test` | Runs the project test suite. |

### Local Database Requirement

Some project scripts expect a local PostgreSQL database to be available at
`localhost:5434`. These scripts also expect a clean database state. If the
local database already contains old tables, stale migrations, test data, or
partially applied schema changes, development or validation commands may fail
or produce misleading results.

| Requirement | Meaning |
| --- | --- |
| `localhost:5434` | Local PostgreSQL must be running on port `5434` for database-dependent development scripts. |
| Clean database | The local database should be reset before running database-dependent workflows to avoid stale tables, old migrations, or misleading validation results. |

Before running database-dependent local workflows, confirm that the local
PostgreSQL instance is running on port `5434` and that the database has been
reset to a clean state.

---

## Staging Environment Workflow

A true staging environment should use separate resources from production.
Today, the GitHub staging workflow is partially wired but is not yet a complete
production-equivalent staging deployment.

### Current Staging Workflow

The current GitHub staging workflow:

- Builds Docker images for the API, web app, and worker.
- Pushes those images to GitHub Container Registry.
- Runs Supabase migrations against the Supabase project configured in the
  GitHub `staging` environment secrets.
- Only triggers a live staging deployment if `STAGING_DEPLOY_WEBHOOK` is
  configured.
- Only runs staging readiness or smoke checks if the corresponding staging URL
  secrets are configured.

This means the staging workflow can pass without creating or updating a usable
staging website.

### What Staging Deployment Does Today

The current staging workflow:

1. Builds Docker images for `api`, `web`, and `worker`.
2. Pushes those images to GitHub Container Registry under staging tags.
3. Links to the Supabase project configured in the GitHub `staging`
   environment secrets.
4. Runs `pnpm db:migrate:prod` against that configured Supabase project.
5. Triggers a staging deployment only if `STAGING_DEPLOY_WEBHOOK` is configured.
6. Runs staging readiness/smoke checks only if the staging readiness/smoke URL
   secrets are configured.

Important: the staging workflow touches whichever Supabase project is
configured in the GitHub `staging` environment secrets. For a true staging
setup, those secrets must point to a separate staging Supabase project, not
production.

### Required Changes for True Staging

To make staging production-equivalent, Zbooni should configure:

- A separate Supabase staging project.
- GitHub `staging` environment secrets pointing to the staging Supabase
  project, not production.
- A Railway staging environment or separate Railway staging project.
- Staging versions of `lead-flood-api` and `lead-flood-worker`.
- Railway staging variables pointing to the staging Supabase project.
- A Vercel Preview/staging deployment pointing to the staging Railway API.
- Test or limited provider keys where possible.
- Email sending disabled or restricted to safe test addresses until staging is
  verified.

### Recommended Staging Resource Map

| Resource | Recommended Staging Setup |
| --- | --- |
| GitHub repo | `Zbooni/zbooni-lead-flood` |
| GitHub environment | `staging` |
| Supabase | Separate staging project |
| Railway | Staging environment or separate staging project |
| Vercel | Preview or staging deployment |
| Provider keys | Test or limited keys where possible |
| Email | Disabled, test-only, or restricted to safe internal addresses |

### Staging Setup from the GUIs

A true staging setup should use separate resources from production.

1. In Supabase, create a separate staging project.
2. In Railway, create or select a staging environment.
3. In Railway, configure staging variables for both `lead-flood-api` and
   `lead-flood-worker`.
4. In Vercel, use Preview deployments or a dedicated staging project.
5. Point Vercel staging variables at the Railway staging API.
6. Point Railway staging variables at the staging Supabase project.
7. Use test or limited provider keys where possible.
8. Keep outbound messaging disabled until the staging setup is verified.

### Staging Safety Rule

Staging should not share the production Supabase database if the goal is to
safely test worker jobs, discovery, enrichment, AI scoring, drafting, or
outbound email.

If staging points at production Supabase, then staging actions can modify
production data and spend production provider credits.

---

## Production Deployment Workflow

Production should use the following resources:

| Resource | Production Value |
| --- | --- |
| Supabase project | `cbcgrzvqidtrtrtnzlso` |
| Railway environment | `production` |
| Frontend deployment | Vercel production deployment |
| GitHub branch | `main` |

### Recommended Production Sequence

| Command | What it does |
| --- | --- |
| `git checkout main` | Switches the working checkout to the production branch. |
| `git pull` | Pulls the latest changes from the remote repository. |
| `git status` | Confirms that the working checkout is clean before deployment. |
| `pnpm install --frozen-lockfile` | Installs dependencies exactly from the lockfile. |
| `pnpm typecheck` | Runs TypeScript type checks before deployment. |
| `pnpm lint` | Runs linting before deployment. |
| `SUPABASE_PROJECT_REF=cbcgrzvqidtrtrtnzlso pnpm db:link` | Links the local checkout to the production Supabase project before backup or migration work. |
| `mkdir -p backups/supabase` | Creates a local backup directory. Do not commit this directory to Git. |
| `supabase db dump --linked --file "backups/supabase/prod-$(date +%Y%m%d-%H%M%S).sql"` | Creates a production database backup before risky work. |
| `gh workflow run Deploy --ref main -f environment=production` | Starts the controlled production deployment through GitHub Actions. |
| `gh run list --workflow Deploy --limit 5` | Lists recent deployment workflow runs. |
| `gh run watch` | Watches the selected workflow run until completion. |
| `pnpm dlx vercel@latest --prod` | Manually deploys the production frontend if Vercel was not deployed automatically. |

### What Production Deployment Does

The GitHub production workflow performs:

1. Verifies that the workflow was dispatched from `main`.
2. Links to the production Supabase project using GitHub production environment
   secrets.
3. Runs `pnpm db:migrate:prod`, which applies SQL migrations from
   `supabase/migrations`.
4. Deploys `lead-flood-api` to Railway production.
5. Deploys `lead-flood-worker` to Railway production.
6. Runs API readiness and smoke checks.

The GitHub production workflow does not deploy Vercel today. Until the Vercel
project is connected to GitHub or a Vercel deploy step is added to GitHub
Actions, frontend production deploys must be done manually with:

```bash
pnpm dlx vercel@latest --prod
```

### Manual Railway Production Deployment

If deploying Railway manually instead of using GitHub Actions, use these
commands.

| Command | What it does |
| --- | --- |
| `railway up --project 9349f31f-3195-4778-9a7a-71b229fdb67d --environment production --service lead-flood-api --ci --message "Deploy production $(git rev-parse --short HEAD)"` | Deploys the API service to Railway production. |
| `railway up --project 9349f31f-3195-4778-9a7a-71b229fdb67d --environment production --service lead-flood-worker --ci --message "Deploy production $(git rev-parse --short HEAD)"` | Deploys the worker service to Railway production. |

### Manual Vercel Production Deployment

| Command | What it does |
| --- | --- |
| `pnpm dlx vercel@latest --prod` | Deploys the frontend to Vercel production if Git integration or GitHub Actions did not deploy it automatically. |

### Production Deployment from the GUIs

Recommended production path:

1. Confirm the intended code is merged into GitHub `main`.
2. Open GitHub **Actions**.
3. Run the **Deploy** workflow with environment `production`.
4. Wait for the workflow to pass.
5. Open Railway and confirm API and worker deployments succeeded.
6. Open Vercel and confirm the frontend production deployment succeeded.
7. Open Supabase and confirm the database is healthy.
8. Run the smoke test checklist manually in the browser.

---

## Smoke Testing and Final Checks

### Production Smoke Test Commands

| Command | What it does |
| --- | --- |
| `curl -fsS https://lead-flood-api-production.up.railway.app/health` | Checks that the API health endpoint returns successfully. |
| `curl -fsS https://lead-flood-api-production.up.railway.app/ready` | Checks that the API readiness endpoint returns successfully. |
| `SMOKE_WEB_BASE_URL=https://zbooni-lead-flood.vercel.app SMOKE_API_BASE_URL=https://lead-flood-api-production.up.railway.app SMOKE_CORS_ORIGIN=https://zbooni-lead-flood.vercel.app bash scripts/release/smoke-production.sh` | Runs the production smoke test script against the Vercel frontend and Railway API. |

### Manual Smoke Test Checklist

After deployment, verify:

1. API health URL returns OK.
2. API readiness URL returns ready.
3. Login works.
4. Dashboard loads.
5. ICP profiles load.
6. Leads list loads.
7. Lead detail page loads.
8. Score and reasoning are visible where expected.
9. One safe test draft can be generated.
10. One test email can be sent from `gino@zboonisales.com`.
11. A reply appears in the inbox.
12. A small discovery job can be queued.
13. The worker processes the job.

---

## GitHub: Source Code and Deployment Workflow

GitHub is the source of truth for the application code and the main controlled
deployment path.

- Repository: <https://github.com/Zbooni/zbooni-lead-flood>
- Main branch: `main`
- Manual deployment workflow: `.github/workflows/deploy.yml`

### CI vs Deployment

- **CI** runs automatically on pull requests and pushes to `main`. It validates
  the code with tests, linting, typechecks, builds, and local/disposable
  database checks. CI does not deploy production services.
- **Production deployment** is manually triggered from GitHub Actions. It
  applies Supabase SQL migrations, deploys the Railway API, deploys the Railway
  worker, and runs smoke checks.
- **Staging deployment** is manually triggered from GitHub Actions, but today it
  is only partially wired. It builds and publishes staging Docker images,
  applies migrations to the configured staging Supabase project, and only
  triggers a live staging deployment if staging deployment webhook secrets are
  configured.

### GitHub CLI Commands

| Command | What it does |
| --- | --- |
| `gh workflow run Deploy --ref main -f environment=production` | Manually dispatches the production deployment workflow from the `main` branch. |
| `gh workflow run Deploy --ref main -f environment=staging` | Manually dispatches the staging deployment workflow from the `main` branch. |
| `gh run list --workflow Deploy --limit 5` | Lists the five most recent runs for the Deploy workflow. |
| `gh run watch` | Watches the selected GitHub Actions run until it finishes. |

Production deployments should be dispatched from the `main` branch.

### GitHub GUI Operations

#### Review Code and Repository Settings

1. Open the repository in GitHub.
2. Confirm the active branch is `main`.
3. Use the **Code** tab to review source files.
4. Use **Settings** to manage repository access, secrets, environments, and
   branch protection.

#### Run a Deployment from GitHub

1. Open the repository in GitHub.
2. Click **Actions**.
3. Select the **Deploy** workflow.
4. Click **Run workflow**.
5. Select branch: `main`.
6. Select environment: `production` or `staging`.
7. Click **Run workflow**.
8. Wait for all jobs to pass.

Production deploys should normally be run from `main`. If the workflow fails,
open the failed job and read the logs before retrying.

#### Manage GitHub Secrets

1. Open the repository.
2. Go to **Settings**.
3. Open **Secrets and variables**.
4. Open **Actions**.
5. Add or update secrets under the correct environment.

Do not place secret values in commits, tickets, documents, screenshots, or chat
messages.

---

## Supabase: Database, Auth, and Operational State

Supabase stores the production database, authentication state, leads, ICPs,
scores, scrape/enrichment records, jobs, and message state.

- Production project ref: `cbcgrzvqidtrtrtnzlso`
- Project URL: <https://cbcgrzvqidtrtrtnzlso.supabase.co>

### Supabase CLI Commands

| Command | What it does |
| --- | --- |
| `supabase login` | Logs the operator into the Supabase CLI. |
| `supabase projects list` | Lists Supabase projects accessible to the logged-in account. Use this to confirm access before linking. |
| `SUPABASE_PROJECT_REF=<project-ref> pnpm db:link` | Links the working checkout to a Supabase project using a generic project ref. |
| `SUPABASE_PROJECT_REF=cbcgrzvqidtrtrtnzlso pnpm db:link` | Links the checkout to the production Supabase project. |
| `SUPABASE_PROJECT_REF=<project-ref> SUPABASE_DB_PASSWORD='<password>' pnpm db:link` | Links non-interactively when the CLI requires the database password. Use secret-safe handling for the password. |
| `pnpm db:migrate:prod` | Applies committed SQL migrations from `supabase/migrations` to the linked Supabase project. |
| `pnpm db:verify:prod` | Verifies the production database migration state. |
| `mkdir -p backups/supabase` | Creates a local ignored backup directory before dumping database backups. |
| `supabase db dump --linked --file "backups/supabase/backup-$(date +%Y%m%d-%H%M%S).sql"` | Creates a full SQL backup of the linked Supabase database. Do not commit this file to Git. |
| `supabase db dump --linked --data-only --file "backups/supabase/data-$(date +%Y%m%d-%H%M%S).sql"` | Creates a data-only SQL backup of the linked Supabase database. Do not commit this file to Git. |

Write database backups to a secure temporary location or ignored backup
directory. Do not commit database backup files to Git.

### Supabase GUI Operations

#### Confirm Project Ownership

1. Open the Supabase dashboard.
2. Switch to the Zbooni organization.
3. Confirm the transferred project appears in the project list.
4. Open the project and confirm the project ref is `cbcgrzvqidtrtrtnzlso`.

#### Inspect Tables

1. Open the Supabase project.
2. Go to **Table Editor**.
3. Inspect core tables such as leads, ICP profiles, score predictions, jobs,
   message variants, and message sends.

Use the Table Editor for inspection. Avoid manually editing production data
unless the change is intentional and understood.

#### Find API and Database Settings

1. Open the Supabase project.
2. Go to **Project Settings**.
3. Use **API** for project URL and anon/service keys.
4. Use **Database** or **Connect** for database connection strings.

Service role keys and database passwords are secrets. They should only be
copied into Railway, Vercel, or GitHub Actions secret storage.

### Supabase Schema Change Rule

Production schema changes should come from committed SQL migrations in the
repository and deployment workflow, not manual dashboard edits.

The Supabase SQL Editor is acceptable for inspection or emergency one-off
operations, but the normal production path should remain:

```text
GitHub commit -> GitHub Actions deploy -> Supabase migrations
```

---

## Railway: API and Worker Runtime

Railway runs the backend API and background worker.

- Railway project: <https://railway.com/project/9349f31f-3195-4778-9a7a-71b229fdb67d>
- API service: `lead-flood-api`
- Worker service: `lead-flood-worker`
- Production environment: `production`

### Railway CLI Commands

| Command | What it does |
| --- | --- |
| `railway login` | Logs the operator into the Railway CLI. |
| `railway list` | Lists Railway projects accessible to the logged-in account. |
| `railway link --project 9349f31f-3195-4778-9a7a-71b229fdb67d --environment production` | Links the working checkout to the Zbooni Railway production project. |
| `railway status` | Shows the currently linked Railway project, environment, and service context. |
| `railway variable list --service lead-flood-api --environment production` | Lists production variables for the API service. Important: this can expose values in the terminal. Prefer the GUI for management demos. |
| `printf '%s' "$VALUE" \| railway variable set VARIABLE_NAME --stdin --service lead-flood-api --environment production` | Sets a secret variable safely from standard input instead of placing the value directly in the shell command. |
| `railway variable set APP_ENV=production --service lead-flood-api --environment production` | Sets a non-secret API service variable directly. |
| `railway up --project 9349f31f-3195-4778-9a7a-71b229fdb67d --environment production --service lead-flood-api --ci --message "Deploy production $(git rev-parse --short HEAD)"` | Manually deploys the API service to Railway production. |
| `railway up --project 9349f31f-3195-4778-9a7a-71b229fdb67d --environment production --service lead-flood-worker --ci --message "Deploy production $(git rev-parse --short HEAD)"` | Manually deploys the worker service to Railway production. |
| `railway logs --service lead-flood-api --environment production --lines 100` | Shows the latest 100 API service logs. |
| `railway logs --service lead-flood-worker --environment production --lines 100` | Shows the latest 100 worker service logs. |
| `railway logs --service lead-flood-api --environment production --lines 100 --filter "@level:error"` | Shows recent API error logs. |
| `railway restart --service lead-flood-api --environment production` | Restarts the API service without rebuilding. Use for transient runtime issues, not code changes. |

Important: Railway variable listing can expose values in the terminal. For a
management demo, show variable names only in the Railway GUI when possible.

### Railway GUI Operations

#### Inspect Services

1. Open the Railway project.
2. Select the correct environment, usually `production`.
3. Confirm both services are present:
   - `lead-flood-api`
   - `lead-flood-worker`
4. Open each service and confirm the latest deployment is successful.

#### Manage Environment Variables

1. Open the Railway project.
2. Select the environment, such as `production`.
3. Click the service, for example `lead-flood-api`.
4. Open the **Variables** tab.
5. Add, edit, or remove variables.
6. Review staged changes.
7. Deploy the changes so they take effect.

Repeat the same process for `lead-flood-worker`.

Important: Railway variable changes are staged first. They do not affect the
running service until the staged changes are deployed.

#### View Logs

1. Open the Railway project.
2. Select the service.
3. Open the latest deployment.
4. View deploy logs or runtime logs.
5. For broader debugging, use Railway's **Observability** or log explorer.

Use API logs for request/auth/CORS/webhook errors. Use worker logs for
discovery, scoring, enrichment, drafting, and email-send jobs.

#### Restart or Redeploy

1. Open the Railway service.
2. Open the latest deployment.
3. Use **Redeploy** or **Restart** depending on whether code/config changed.

Use redeploy after code or environment variable changes. Use restart only for
transient runtime issues.

---

## Vercel: Frontend Web App

Vercel runs the operator-facing web application.

- Current app URL: <https://zbooni-lead-flood.vercel.app>
- Main route: <https://zbooni-lead-flood.vercel.app/dashboard>

### Current Vercel Status

At the time of this handoff, the Vercel project is not yet connected to the
Zbooni GitHub repository. Because of that:

- Pushing to `origin/main` does not automatically update the Vercel frontend.
- Running the GitHub production deploy workflow does not update the Vercel
  frontend.
- Frontend changes must be deployed manually through the Vercel CLI until the
  GitHub repository is connected. The Vercel dashboard can redeploy or promote
  existing deployments, but it cannot deploy new local source-code changes
  unless the project is connected to Git.

### Future Git-Connected Vercel Setup

Once Vercel is connected to `Zbooni/zbooni-lead-flood`:

- Vercel can automatically create Preview deployments for pull requests and
  non-production branches.
- Vercel can automatically create Production deployments when code is pushed or
  merged to the configured production branch, usually `main`.
- If Zbooni wants frontend deployment to wait for successful GitHub checks,
  configure Vercel deployment through GitHub Actions after CI passes, or
  configure Vercel Git/build settings to gate deployments.

The most controlled long-term option is:

```text
GitHub CI passes -> GitHub deployment workflow runs -> Vercel CLI deploys frontend from GitHub Actions
```

### Vercel CLI Commands

| Command | What it does |
| --- | --- |
| `pnpm dlx vercel@latest login` | Logs the operator into the Vercel CLI. |
| `pnpm dlx vercel@latest whoami` | Shows the active Vercel account. Confirm this is the Zbooni Vercel team or an account with access to the Zbooni project. |
| `cat .vercel/project.json` | Shows the local Vercel project link. It should point to the intended `zbooni-lead-flood` project. |
| `pnpm dlx vercel@latest link` | Links the local checkout to a Vercel project when `.vercel/project.json` is missing or incorrect. Select the Zbooni team and existing `zbooni-lead-flood` project when prompted. |
| `pnpm dlx vercel@latest` | Deploys a Vercel Preview deployment. This is only a true staging environment if it points to staging backend resources. |
| `pnpm dlx vercel@latest --prod` | Deploys the frontend to Vercel production manually. This is required until the Vercel project is connected to GitHub or deployed from GitHub Actions. |

A Vercel Preview is staging-like for frontend review, but it is only a true
staging environment if it points to staging backend resources. If the preview
points to production Railway and production Supabase, it is testing frontend
code against production data.

### Vercel GUI Operations

#### Inspect the Project

1. Open the Zbooni Vercel dashboard.
2. Open the `zbooni-lead-flood` project.
3. Check the latest deployment status.
4. Confirm the project is connected to the Zbooni GitHub repository.

#### Manage Environment Variables

1. Open the Vercel project.
2. Go to **Settings**.
3. Open **Environment Variables**.
4. Add or update variables for the correct environment:
   - Production
   - Preview
   - Development
5. Redeploy after changing variables.

Vercel environment variable changes do not modify already-built deployments. A
new deployment is required.

#### Frontend Variables to Check

- `NEXT_PUBLIC_API_BASE_URL`
- `API_BASE_URL`
- `ADMIN_API_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

`NEXT_PUBLIC_API_BASE_URL` and `API_BASE_URL` should point to the Railway API
URL.

#### Add a Custom Domain

1. Open the Vercel project.
2. Go to **Settings**.
3. Open **Domains**.
4. Add the desired Zbooni-owned domain.
5. Follow the DNS instructions shown by Vercel.
6. Once active, update Railway `CORS_ORIGIN` to include the new domain.
7. Redeploy or restart the Railway API.

---

## Management Demo Flow

For an internal management demo of the setup, show the dashboards in this
order:

1. GitHub: repository under Zbooni ownership.
2. GitHub Actions: deployment workflow and latest run.
3. Supabase: transferred project, project ref, tables, and existing lead
   records.
4. Railway: API and worker services, successful deployments, variables tab, and
   logs.
5. Vercel: frontend project, latest deployment, production URL, and environment
   variables.
6. Resend: verified sender domain, receiving status, and webhook endpoint.
7. App: login, dashboard, leads, drafting, sending, inbox, and jobs.

The point of the demo is to show that Zbooni owns the code, database, runtime
services, frontend deployment, provider configuration, and operational path.

---

## Suggested Call Explanation

> There are two deployment levels we should distinguish.
>
> The current Zbooni-owned URL is a working acceptance/live environment. It is
> connected to the transferred Supabase database, Railway API and worker,
> Vercel frontend, provider keys, and Resend.
>
> If Zbooni wants a strict staging/production split, staging should be a
> separate Supabase project plus a Railway staging environment and Vercel
> preview/staging deployment. That prevents staging tests from modifying
> production data or spending production provider credits.
>
> Production should stay tied to main, the transferred Supabase project,
> Railway production services, and the Vercel production deployment. Production
> deploys should go through the manual GitHub Actions workflow or an equivalent
> controlled release process.

---

## Management Summary

Zbooni can manage the system through the GUIs for normal visibility and
ownership tasks. That includes checking deployments, viewing logs, managing
environment variables, inspecting database state, configuring domains, and
confirming that the services are inside Zbooni-controlled accounts.

For production changes, the safer operating model is to use the repository,
committed migrations, and the manual GitHub Actions deployment workflow. This
keeps deployments repeatable, traceable, and easier to recover from if
something breaks.

---

## What Should Not Be Done from the GUI

- Do not manually edit production schema as the normal deployment path.
- Do not paste secrets into documents, tickets, screenshots, or chat.
- Do not reset or seed the production database unless intentionally replacing
  production data.
- Do not enable optional providers without credentials, budget awareness, and a
  smoke test.
- Do not change the app domain without updating Railway CORS.
