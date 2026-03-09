# Frontend Build — Zbooni Sales OS Dashboard

## What You're Building

The browser dashboard for Lead-Flood, an AI-powered sales pipeline. The entire backend is complete — API on :5050, worker jobs, auth, everything. You're building the frontend that lets the sales team operate it.

**Pages:** Login → Pipeline funnel (home) → Lead explorer table → Lead detail → Message approval queue → ICP management → Analytics

## The Plan

Read `docs/plans/2026-02-17-frontend-dashboard-plan.md` — it has 11 tasks covering setup through final verification, with exact file paths, code, and step-by-step instructions. Follow it.

## Tech Stack

- Next.js 15 (App Router), React 19, TypeScript
- Tailwind CSS 4, shadcn/ui (New York style, Zinc base), Recharts
- `@lead-flood/contracts` for shared Zod schemas
- API client with JWT auth hitting `localhost:5050`

## Design Tools

You have two frontend design resources available. Use them:

1. **Anthropic's official skill**: `frontend-design:frontend-design` — invoke via the Skill tool for aesthetic guidance, anti-slop rules, and creative direction
2. **Custom research agent**: `frontend-designer` — a comprehensive agent at `~/.claude/agents/frontend-designer.md` built from 100+ sources covering typography, color systems, navigation architecture, cognitive load, component patterns, and accessibility. Spawn it via the Task tool when you need deep design decisions.

You also have **Pencil** — a design editor accessible through `mcp__pencil__*` tools. If you want to prototype layouts, explore component compositions, or validate designs visually before coding, use it. It reads/writes `.pen` files and can screenshot designs for verification. I WILL BE USING THE SOFTWARE TO POTENTIALLY EDIT YOUR DESIGN, you will not have much use for it, so make sure that when you are done, I can see your design on pencil. 

## Key Project Rules

- **pnpm only** — never npm. Path: `/Users/os_architect/.nvm/versions/node/v22.22.0/bin/pnpm`
- **Branch**: `peem` — commit there
- **TypeScript strict mode** with `exactOptionalPropertyTypes` — add `| undefined` to optional props
- **Workspace deps**: `workspace:*` for internal packages
- Quality gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

## Where Things Live

```
apps/web/          ← Next.js app (currently just skeleton)
apps/api/          ← Backend API on :5050 (complete)
packages/contracts/ ← Shared Zod schemas
CLAUDE.md          ← Project rules
PRD.md             ← Product requirements
```

## What "Good" Looks Like

A dashboard a sales team actually wants to use. Not a generic shadcn template — something with a clear aesthetic identity, thoughtful information hierarchy, and polished interactions. The design skills exist specifically to prevent AI-default aesthetics. Use them.
