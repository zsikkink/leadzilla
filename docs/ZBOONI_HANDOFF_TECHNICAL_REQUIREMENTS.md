# Lead-Flood Handoff: Technical Requirements for Zbooni

## Current Architecture

The platform currently runs as three separate services:

- Web app
- API service
- Background worker

It also depends on:

- PostgreSQL database
- Supabase Auth / JWT-based auth in the current implementation
- External provider accounts for selected capabilities like discovery, enrichment, messaging, and AI

So the fastest handoff path is not EC2 + S3 alone. EC2 can host the services, but the application also needs a compatible database/auth setup and the relevant provider credentials.

One important note here: the current system is not just "using Postgres." It is tightly integrated with Supabase across:

- authentication (JWT issuance and validation)
- database structure and access patterns
- admin/user bootstrapping tied to Supabase auth tables

Because of this, switching away from Supabase is not a simple infrastructure swap. It would require:

- replacing the auth system (`Supabase Auth -> Cognito` or a custom JWT system)
- updating API validation logic that assumes Supabase-issued tokens
- refactoring parts of the web app that rely on the Supabase client
- reworking certain database assumptions tied to Supabase schemas

In other words, moving to fully AWS-native DB/Auth would be a product engineering effort, not just a deployment configuration change. For that reason, moving off Supabase is not recommended for the handoff path.

---

## Recommended Fastest Handoff Path

For the quickest deployment into Zbooni-owned infrastructure, we recommend:

- hosting the web, API, and worker in Zbooni-managed AWS compute
- continuing to use a Zbooni-owned Supabase project for database and auth in phase 1
- starting with a smaller initial capability set:
  - discovery
  - AI-assisted drafting
  - email sending
  - manual approval before outbound sends
  - Hunter (for controlled contact enrichment)

This avoids unnecessary re-engineering during handoff and allows the system to run reliably with its current architecture.

The hosted application services (`web`, `api`, and `worker`) should be portable from the current temporary setup to Zbooni-managed AWS compute. The bigger constraint is not the application runtime layer, but the current dependency on Supabase for database and authentication.

### Note on Supabase Plan

The current system has been developed against Supabase, and continuing with it provides:

- a fully managed Postgres instance (no DB ops overhead)
- built-in auth that is already wired into the system
- easy environment setup and faster deployment
- fewer moving parts during handoff

The free Supabase tier can work for initial testing, but it has limitations around:

- connection limits
- compute performance
- database size
- background usage constraints

For production usage, upgrading to a paid Supabase plan (typically starting around `$25/month` and scaling based on usage) would provide:

- higher connection and throughput limits
- better performance under load (important for worker + queue usage)
- more reliable uptime characteristics
- fewer constraints when running discovery, enrichment, and messaging pipelines concurrently

Compared to the engineering cost of replacing Supabase entirely, staying on Supabase (and upgrading plans as needed) is significantly lower effort and risk.

---

## What We Need From Zbooni

To stand the system up in your environment, we would need:

### Infrastructure

- compute environment for web, API, and worker
- public HTTPS endpoint(s)
- DNS / SSL path
- secure secret management
- deployment access or someone on your side who can execute deployment steps with us

### Data / Auth

- confirmation that phase 1 can use a Zbooni-owned Supabase project for DB/auth
- if not, we would need to scope the engineering work required to replace Supabase with AWS-native services

### Provider Accounts for Phase 1

- Google Places API
- OpenAI API
- Resend account + verified sending domain
- Hunter API (for contact discovery with controlled usage)

### Optional Phase 2 Providers

- Trengo / WhatsApp
- Apollo
- Slack notification channel

---

## What We Will Provide

We will provide:

- deployment guidance for web, API, and worker
- environment variable / secrets checklist
- database schema/bootstrap steps
- admin bootstrap
- operator walkthrough
- recommended safe initial settings for budgets, approvals, and send limits

---

## Important Current Limitations

A few important points to be aware of:

- Gmail sending is not currently implemented; the current email path is Resend
- The system does not yet have a built-in human approval step before paid Apollo/Hunter unlocks
- The current implementation is tightly coupled to Supabase for DB/auth, so replacing it would require dedicated engineering work rather than simple configuration

---

## Questions for Zbooni

To finalize the handoff plan, we need alignment on the following:

### 1. AWS Hosting / Deployment

We believe the application runtimes themselves should be able to move from the current temporary hosted setup to Zbooni-managed AWS compute, as long as we have the right access and infrastructure in place.

To do that, we would need to know:

1. Do you want us to deploy the application services (`web`, `api`, and `worker`) into your AWS environment instead of continuing to use the current temporary hosted setup?
2. If yes, what AWS setup do you want to use for this:
   - a single EC2 instance
   - multiple EC2 instances
   - Docker on EC2
   - another internal hosting pattern you already use
3. Can you provide:
   - server access / login
   - the target public domain(s) or subdomain(s)
   - SSL/TLS setup path
   - a secure way to provide and store environment variables / secrets
4. Who on your side would own:
   - AWS infrastructure setup
   - DNS / domain configuration
   - secrets management
   - ongoing server maintenance after handoff

### 2. Database / Auth

A separate question is the database and authentication layer.

Right now, the platform is tightly coupled to Supabase for both Postgres and auth. Because of that, moving away from Supabase would require dedicated engineering work, not just deployment changes, and is not recommended for the handoff path.

So for phase 1:

5. Are you comfortable using a Zbooni-owned Supabase project for database + authentication in the initial handoff?
6. If not, should we separately scope the engineering work required to replace Supabase with AWS-native services?

### 3. Email / Outreach Setup

7. For email outreach, are you comfortable using Resend in phase 1, or is Gmail / Google Workspace a hard requirement?
8. If email outreach is enabled, what sender domain should be used?
9. Who on your side can help verify the sending domain and DNS records needed for email delivery?

### 4. Trengo / WhatsApp Setup

10. Do you want Trengo / WhatsApp included in phase 1, or should that be enabled later?
11. If you want Trengo / WhatsApp enabled, we would need Zbooni's specific Trengo credentials and configuration to connect your account(s) to the platform, including:
   - Trengo API key
   - the relevant WhatsApp-connected channel
   - template/message configuration for outbound sends
   - webhook configuration on your Trengo side, if needed
12. Do you already have a Trengo workspace and WhatsApp channel ready for use, or would that still need to be set up internally first?

### 5. Discovery / Enrichment Providers

13. Which provider accounts do you want to use in phase 1:
   - Google Places
   - Hunter
   - OpenAI
   - Resend
14. What daily or monthly spend limits do you want for discovery and contact enrichment?
15. Do you want a conservative initial rollout with manual review and capped enrichment usage before broader automation is enabled?

### 6. Ownership / Handoff

16. Do you want us to perform the initial deployment directly in your environment using the access you mentioned, or would you prefer that one of your engineers performs the deployment while we guide?
17. After deployment, who will own:
   - infrastructure / uptime
   - provider billing
   - user/admin management
   - webhook issues
   - operational monitoring
18. What level of post-deployment support would you like from us during the handoff period?
