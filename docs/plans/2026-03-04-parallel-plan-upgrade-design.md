# Design: Parallel-Plan Upgrade — Structured Intake, Questioning, Atomic Tasks

**Date:** 2026-03-04
**Status:** Approved

## Problem

1. **Compound bullets** — parallel-plan generates multi-requirement task lines. Agents complete 1-2 sub-requirements and mark the task done.
2. **Raw input quality** — QA feedback is dumped as unstructured notes. The planner must interpret ambiguous descriptions, leading to wrong or incomplete task definitions.
3. **Missing context** — the planner doesn't ask questions before decomposing, so assumptions propagate into session prompts as incorrect tasks.

## Solution

Three additions to `/parallel-plan`. Zero changes to existing content.

### Addition 1: Step 0 — Structured Feedback Intake

Inserted before current Step 1. When input looks like raw QA notes (unstructured observations, bug descriptions, UI complaints), structure them into a table before proceeding:

| # | Page/Area | Component | Type | Severity | Current Behavior | Expected Behavior |
|---|-----------|-----------|------|----------|-----------------|-------------------|

- **Types:** visual, functional, data, performance, ux
- **Severity:** P0 (broken/blocking), P1 (wrong behavior), P2 (polish/improvement)
- **Skip condition:** If input is already a well-defined task description or a GSD phase plan reference, skip directly to Step 1.

### Addition 2: Step 0.5 — Rigorous Questioning Phase

After structuring feedback (or receiving structured input), ask clarifying and non-obvious questions before any decomposition work begins. No limit on rounds or question count — continue until zero ambiguity remains.

**Question categories:**
- **Clarification:** Ambiguous items, missing context, priority conflicts between items
- **Non-obvious:** Downstream impact, edge cases, data dependencies, interaction effects between items, assumptions that need validation

**Mechanism:** Use `AskUserQuestion` with multiple-choice options where possible. Open-ended when the question requires it.

**Exit condition:** The planner has zero remaining questions and can state with full confidence what each item requires.

### Addition 3: Atomic Task Rule (added to Step 6)

A mandatory post-processing pass on every task bullet in every session prompt.

**Rule:** Every task line must have exactly ONE testable objective. Split compound bullets.

**Detection triggers:** "and", "also", "+", semicolons, multiple verbs, sub-bullets with independent objectives.

**Output addition:** Each session prompt gets a TASK COMPLETION GATE — a checkbox list where each task has a one-line acceptance criterion. Agents must confirm every checkbox before reporting done.

## Workflow Integration

### Iteration Cycle (current project debugging)
```
Manual QA → /parallel-plan (raw notes)
  → Step 0: Structure feedback
  → Step 0.5: Question until clear
  → Steps 1-8: Decompose (unchanged)
  → Execute sessions → Merge → /verify → Repeat
```

### Greenfield Cycle (new projects via GSD)
```
/gsd:new-project → /gsd:plan-phase N
  → If phase is large: /parallel-plan (GSD phase plan as input)
    → Step 0: Skipped (input is structured)
    → Step 0.5: Question to catch gaps in GSD plan
    → Steps 1-8: Decompose (unchanged)
    → Execute sessions → Merge → /gsd:verify-work N
  → If phase is small: /gsd:execute-phase N directly
```
