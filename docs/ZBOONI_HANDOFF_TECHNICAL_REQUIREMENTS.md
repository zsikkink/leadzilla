# Lead-Flood Handoff: Technical Requirements for Zbooni

## Current architecture

The platform currently runs as three separate services:
- Web app
- API service
- Background worker

It also depends on:
- PostgreSQL database
- Supabase Auth / JWT-based auth in the current implementation
- External provider accounts for selected capabilities like discovery, enrichment, messaging, and AI

So the fastest handoff path is not EC2 + S3 alone. EC2 can host the services, but the application also needs a compatible database/auth setup and the relevant provider credentials.

One important note here: the current system is not just “using Postgres.” It is tightly integrated with Supabase across:
- authentication (JWT issuance and validation)
- database structure and access patterns
- admin/user bootstrapping tied to Supabase auth tables

Because of this, switching away from Supabase is not a simple infrastructure swap. It would require:
- replacing the auth system (Supabase Auth -> Cognito or custom JWT system)
- updating API validation logic that assumes Supabase-issued tokens
- refactoring parts of the web app that rely on the Supabase client
- reworking certain database assumptions tied to Supabase schemas

In other words, moving to fully AWS-native DB/Auth would be a **product engineering effort**, not just a deployment configuration change.

---

## Recommended fastest handoff path

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

### Note on Supabase plan

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

For production usage, upgrading to a paid Supabase plan (typically starting around **$25/month and scaling based on usage**) would provide:
- higher connection and throughput limits
- better performance under load (important for worker + queue usage)
- more reliable uptime characteristics
- fewer constraints when running discovery, enrichment, and messaging pipelines concurrently

Compared to the engineering cost of replacing Supabase entirely, staying on Supabase (and upgrading plans as needed) is significantly lower effort and risk.

---

## What we need from Zbooni

To stand the system up in your environment, we would need:

### Infrastructure
- compute environment for web, API, and worker
- public HTTPS endpoint(s)
- DNS / SSL path
- secure secret management
- deployment access or someone on your side who can execute deployment steps with us

### Data / auth
- confirmation that phase 1 can use a Zbooni-owned Supabase project for DB/auth
- if not, we would need to scope the engineering work required to replace Supabase with AWS-native services

### Provider accounts for phase 1
- Google Places API
- OpenAI API
- Resend account + verified sending domain
- Hunter API (for contact discovery with controlled usage)

### Optional phase 2 providers
- Trengo / WhatsApp
- Apollo
- Slack notification channel

---

## What we will provide

We will provide:
- deployment guidance for web, API, and worker
- environment variable / secrets checklist
- database schema/bootstrap steps
- admin bootstrap
- operator walkthrough
- recommended safe initial settings for budgets, approvals, and send limits

---

## Important current limitations

A few important points to be aware of:
- Gmail sending is not currently implemented; the current email path is Resend
- The system does not yet have a built-in human approval step before paid Apollo/Hunter unlocks
- The current implementation is tightly coupled to Supabase for DB/auth, so replacing it would require dedicated engineering work rather than simple configuration

---

## Questions for Zbooni

To finalize the handoff plan, we need alignment on:

1. whether phase 1 can proceed using a Zbooni-owned Supabase project for DB/auth
2. what AWS hosting model you prefer for the three services
3. whether email should use Resend or whether Gmail is a hard requirement
4. whether Trengo/WhatsApp should be included in phase 1 or deferred
5. what level of approval/control you want around paid contact-data enrichment (especially with Hunter enabled)
