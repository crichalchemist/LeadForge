# ADR-015: Frontend stack: React + Vite + Tailwind, React Query for server state, @dnd-kit for DnD

## Status

Accepted

## Date

2026-03-14

## Context

Phase 4 introduces the CRM dashboard, which requires a responsive single-page application with:

- A Kanban-style pipeline board with drag-and-drop lead management
- Lead detail views with enrichment data, scores, and call history
- Reporting pages with charts and data visualizations
- Real-time-feeling updates as scores and call outcomes change

The team has strong React experience. The dashboard is an internal tool used by a small sales/ops team, so SEO and server-side rendering are not requirements. Developer experience and iteration speed are priorities.

## Decision

We will use the following frontend stack:

- **React 18** with **TypeScript** for the UI layer
- **Vite** as the build tool and dev server
- **Tailwind CSS** for utility-first styling
- **@tanstack/react-query** for server state management (caching, background refetching, invalidation)
- **recharts** for data visualizations and reporting charts
- **@dnd-kit/core** for accessible, performant drag-and-drop on the pipeline board

The frontend will be a standalone SPA that communicates with the FastAPI backend via REST. It will be served as static assets in production (e.g., behind Nginx or from the FastAPI static mount).

## Consequences

### Positive
- Fast development cycle with Vite's HMR and TypeScript's compile-time safety
- React Query eliminates boilerplate for loading/error states and handles cache invalidation automatically
- @dnd-kit provides accessible DnD with excellent performance characteristics and fine-grained control over drag behavior
- Tailwind keeps styling co-located and avoids CSS specificity wars
- recharts integrates naturally with React's component model

### Negative
- Adding a full SPA introduces a separate build step and asset pipeline
- TypeScript adds compilation overhead (mitigated by Vite's esbuild-based transform)
- Team must learn @dnd-kit's API and React Query's cache model if not already familiar

### Neutral
- No SSR means the app is not indexable by search engines, which is irrelevant for an internal tool
- Bundle size is modest for the chosen libraries but should be monitored as features grow

## Alternatives Considered

1. **Next.js** — Full-featured React framework with SSR/SSG. Rejected because SSR is unnecessary for an internal tool, and Next.js adds complexity (file-based routing, server components) that provides no benefit here.

2. **Vue 3 + Vite** — Capable alternative with excellent DX. Rejected because the team has deeper React experience, and the React ecosystem has more mature options for DnD (dnd-kit) and server state (React Query).

3. **HTMX + server-rendered templates** — Minimal JS approach. Rejected because the Kanban board requires complex drag-and-drop interactions, optimistic updates, and fine-grained UI state that HTMX cannot handle without significant custom JavaScript anyway.
