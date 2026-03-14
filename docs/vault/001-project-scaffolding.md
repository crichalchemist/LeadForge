# ADR-001: Project scaffolding: uv + hatchling, src layout, Docker Compose

## Status

Accepted

## Date

2026-03-14

## Context

LeadForge is a greenfield async pipeline application that will make many concurrent API calls, perform data transformations, and interact with PostgreSQL+PostGIS. We need a modern Python project structure that:
- Minimizes setup friction for developers
- Follows current Python packaging best practices
- Supports async-first development
- Integrates local infrastructure (PostgreSQL, Redis) without manual setup

Technical constraints:
- Must support Python 3.12+ for modern async syntax
- Need reproducible dependency resolution for CI/CD
- Require local development environment (PostGIS, Redis) that's easy to spin up

## Decision

Adopt the following project scaffolding:
1. **Package manager:** uv (Astral's fast Rust-based tool) for dependency resolution and packaging
2. **Build backend:** hatchling (PEP 517-compliant, included with uv)
3. **Project layout:** src layout (`src/leadforge/`) to isolate package code from tests and tooling
4. **Local infrastructure:** Docker Compose for PostGIS database and Redis cache
5. **Configuration:** pyproject.toml (PEP 621) as single source of truth for metadata, dependencies, and tool config

Implementation details:
- pyproject.toml declares all dependencies with version pins
- Dockerfile for containerized application deployment
- docker-compose.yml for local dev environment (postgres service with PostGIS extension, redis service)
- uv.lock file committed for reproducible builds
- Makefile or justfile for common dev tasks

## Consequences

### Positive
- **Fast dependency resolution:** uv is ~10-100x faster than pip and Poetry
- **PEP 621 compliance:** Single pyproject.toml file, easier to migrate to other tools
- **Clean import paths:** src layout prevents `import leadforge` from accidentally importing local directory
- **Easy onboarding:** `uv sync` gets developers up and running instantly
- **Infrastructure as code:** Docker Compose eliminates "works on my machine" problems for databases

### Negative
- **New tool learning curve:** Team must learn uv instead of pip/Poetry (mitigated by excellent docs and `uv sync` simplicity)
- **Dependency on uv's stability:** Astral is backing it actively, but it's newer than pip/Poetry
- **Docker required for full dev experience:** Developers need Docker Desktop or compatible runtime

### Neutral
- Requires explicit mention in contributor docs

## Alternatives Considered

### 1. Poetry + Poetry backend
**Why rejected:** Poetry is significantly slower than uv (~30s vs ~1s for dependency resolution on typical projects). Both poetry and uv achieve similar ergonomic goals, but uv's performance advantage is substantial for a growing codebase.

**Trade-offs:** Poetry has a larger community and longer track record, but doesn't offset the speed penalty for a data pipeline that may iterate frequently on dependencies.

### 2. setuptools + setup.py
**Why rejected:** Legacy approach; pyproject.toml + hatchling is the modern standard. setup.py adds unnecessary boilerplate.

**Trade-offs:** More familiar to older developers, but inconsistent with current Python packaging ecosystem trends.

### 3. Flat layout (`leadforge/` at root)
**Why rejected:** Creates import confusion risk when tests or tools accidentally import local code instead of the installed package.

**Trade-offs:** Slightly simpler file structure initially, but causes subtle bugs as the project grows.

### 4. Manual infrastructure setup (no Docker)
**Why rejected:** Increases onboarding friction and creates environment inconsistencies (different Postgres versions, missing PostGIS, etc.).

**Trade-offs:** Avoids Docker complexity, but at the cost of reliable local development.
