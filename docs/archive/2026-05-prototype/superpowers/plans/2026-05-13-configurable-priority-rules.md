# Configurable Priority Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make QFerry's Gmail-like priority triage configurable through the existing rules file instead of relying only on hard-coded metadata heuristics.

**Architecture:** Extend existing classification rules with an optional `priority` object. `triage_inbox` uses configured priority metadata and `weight` when a rule matches, orders candidates inside each bucket by weight, and falls back to built-in metadata heuristics otherwise. This keeps QQ Mail read-only and preview-first while letting users define sender/domain-specific urgency and bulk rules.

**Tech Stack:** TypeScript, existing QFerry ruleset parser, MCP server schema, `vitest`, plugin fixture/QQ readonly e2e, `pnpm`.

---

## Scope Guard

This slice does not add server-side QQ labels, server-side blacklists, sending, deletion, or full-body analysis. The rules remain local QFerry metadata rules, and every real QQ validation remains read-only unless the user separately authorizes a specific mutation.

## Tasks

- [ ] Add `priority` metadata and optional `weight` to `ClassificationRule`.
- [ ] Parse and validate `rules[].priority` from `qferry.rules.json`.
- [ ] Let `triage_inbox` use configured priority metadata for matched rules before fallback heuristics.
- [ ] Extend MCP rule schema with optional priority fields.
- [ ] Update example rules with non-sensitive priority examples.
- [ ] Add unit/MCP tests for configured priority reason, confidence, weight, nextAction, and bucket ordering.
- [ ] Update plugin skill and acceptance docs.
- [ ] Run `pnpm run check`, plugin fixture e2e, real QQ readonly e2e, cache sync, sensitive scans, commit, and push.
