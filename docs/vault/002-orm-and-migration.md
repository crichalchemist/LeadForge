# ADR-002: ORM and migration: SQLAlchemy 2.0 async + asyncpg, Alembic, UUID PKs

## Status

Accepted

## Date

2026-03-14

## Context

The LeadForge data pipeline makes many concurrent API calls to external sources (Google Places, Socrata, etc.) and must efficiently persist results to PostgreSQL. We need:
- Async database access to avoid blocking I/O during API calls
- A modern ORM that supports async natively
- Reliable schema migrations that can be applied across environments
- Globally unique primary keys suitable for distributed systems and data deduplication

Technical constraints:
- Must support Python 3.12+ async/await syntax
- Pipeline will handle thousands of business entities with frequent updates
- Schema will evolve as new data sources are integrated (Phase 2, 3, 4)

## Decision

Adopt SQLAlchemy 2.0 with async support:
1. **ORM:** SQLAlchemy 2.0 (released late 2023) with async extensions
2. **Database driver:** asyncpg for PostgreSQL (native async, written in Cython)
3. **Primary keys:** UUID (uuid6 library) on all entities for distributed ID generation
4. **Migrations:** Alembic (SQLAlchemy's native migration tool) with auto-detection enabled for rapid development

Implementation details:
- Session factory uses async_sessionmaker() for creating AsyncSession instances
- All database queries use `async with session:` context managers
- Entities inherit from declarative base with UUID primary keys
- Alembic configured with env.py for async migration runner
- Connection pooling via asyncpg.pool for optimal concurrency

## Consequences

### Positive
- **Full async I/O pipeline:** API calls, database writes, and logging all non-blocking; eliminates thread pool overhead
- **SQLAlchemy ecosystem:** Rich tooling, type hints, comprehensive ORM features (relationships, eager loading, etc.)
- **UUID PKs enable deduplication:** No distributed ID service needed; UUIDs are globally unique by design
- **Alembic handles schema versioning:** Clear audit trail of schema changes; easy rollback if needed
- **asyncpg performance:** Faster than psycopg2 for concurrent workloads (pipeline's primary use case)

### Negative
- **Async adds complexity:** Developers must understand async/await thoroughly; easier to introduce deadlocks or race conditions
- **Alembic learning curve:** Auto-generated migrations sometimes require manual fixes for complex schema changes
- **PostgreSQL-specific:** asyncpg is PostgreSQL only (but we're committed to PostgreSQL, so not a blocker)

### Neutral
- SQLAlchemy 2.0's "future" mode became standard; requires updated syntax vs. SQLAlchemy 1.4 (but 1.4 is EOL soon anyway)

## Alternatives Considered

### 1. Tortoise ORM
**Why rejected:** Newer, less mature than SQLAlchemy. Smaller community and fewer third-party integrations. No compelling advantage over SQLAlchemy's async support.

**Trade-offs:** Simpler for simple queries but less flexible for complex relationships. Higher risk of unsupported edge cases in a data pipeline context.

### 2. Django ORM (with django-stubs async support)
**Why rejected:** Django is sync-first; async support is bolted on and less idiomatic. Requires Django project structure, which is overkill for a pipeline (FastAPI is more appropriate).

**Trade-offs:** Django's admin and migration UI are excellent, but we're not building a CRUD app.

### 3. Raw asyncpg queries (no ORM)
**Why rejected:** No ORM means writing SQL manually for every query, increasing maintenance burden and bug risk as the schema grows.

**Trade-offs:** Maximum performance control, but not worth the maintenance cost given SQLAlchemy's async performance is already excellent.

### 4. Integer auto-increment primary keys
**Why rejected:** Not suitable for a distributed pipeline. If we ever replicate data or distribute processing, auto-increment IDs collide. UUIDs are future-proof.

**Trade-offs:** Slightly smaller primary key storage (8 bytes vs. 16), but negligible at the expected scale (~100k businesses).

### 5. Peewee + auto-migrations
**Why rejected:** Peewee's async support is limited compared to SQLAlchemy 2.0. Auto-migrations are less flexible than Alembic.

**Trade-offs:** Simpler for small projects, but less suitable for evolving data schemas across 4 phases.
