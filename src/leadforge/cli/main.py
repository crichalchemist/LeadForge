import asyncio
from typing import Optional

import structlog
import typer

from leadforge.db.models.business import NicheType

app = typer.Typer(
    name="leadforge", help="Lead generation pipeline for hyper-local small businesses"
)
logger = structlog.get_logger()


def _get_niche(niche_str: str) -> NicheType:
    """Convert string to NicheType enum."""
    try:
        return NicheType(niche_str)
    except ValueError:
        typer.echo(f"Invalid niche: {niche_str}")
        typer.echo(f"Valid niches: {', '.join(n.value for n in NicheType)}")
        raise typer.Exit(1)


@app.command()
def pipeline(
    zip_code: str = typer.Option(..., "--zip", help="Chicago zip code to target"),
    niche: str = typer.Option(..., "--niche", help="Business niche to target"),
    limit: Optional[int] = typer.Option(
        None, "--limit", help="Max businesses to discover"
    ),
):
    """Run the discovery pipeline: Socrata → Google Places → Score → Persist."""
    niche_enum = _get_niche(niche)

    async def _run():
        from leadforge.db.session import async_session
        from leadforge.pipeline.discovery import run_discovery

        async with async_session() as session:
            businesses = await run_discovery(session, zip_code, niche_enum, limit=limit)
            typer.echo(f"\nDiscovered and persisted {len(businesses)} businesses")
            for biz in businesses[:10]:
                typer.echo(f"  - {biz.name} ({biz.zip_code})")
            if len(businesses) > 10:
                typer.echo(f"  ... and {len(businesses) - 10} more")

    asyncio.run(_run())


@app.command()
def export(
    zip_code: Optional[str] = typer.Option(None, "--zip", help="Filter by zip code"),
    niche: Optional[str] = typer.Option(None, "--niche", help="Filter by niche"),
    min_score: Optional[float] = typer.Option(
        None, "--min-score", help="Minimum composite score"
    ),
    output: str = typer.Option(
        "leads.csv", "--output", "-o", help="Output CSV file path"
    ),
):
    """Export scored leads to CSV."""

    async def _run():
        from leadforge.db.session import async_session
        from leadforge.export.csv_export import export_leads_csv

        async with async_session() as session:
            count = await export_leads_csv(
                session, output, zip_code=zip_code, niche=niche, min_score=min_score
            )
            typer.echo(f"Exported {count} leads to {output}")

    asyncio.run(_run())


@app.command()
def enrich(
    zip_code: str = typer.Option(..., "--zip", help="Chicago zip code to target"),
    niche: str = typer.Option(..., "--niche", help="Business niche to target"),
):
    """Run enrichment for all businesses in a zip+niche."""
    niche_enum = _get_niche(niche)

    async def _run():
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload

        from leadforge.db.models.business import Business
        from leadforge.db.session import async_session
        from leadforge.pipeline.enrichment import enrich_business

        async with async_session() as session:
            result = await session.execute(
                select(Business)
                .options(selectinload(Business.digital_presence))
                .where(Business.zip_code == zip_code, Business.niche == niche_enum)
            )
            businesses = result.scalars().all()

            typer.echo(
                f"Enriching {len(businesses)} businesses in {zip_code} ({niche})..."
            )

            enriched_count = 0
            for business in businesses:
                try:
                    await enrich_business(session, business)
                    enriched_count += 1
                except Exception as e:
                    logger.error(
                        "enrichment_failed", business=business.name, error=str(e)
                    )

            await session.commit()
            typer.echo(f"Enriched {enriched_count}/{len(businesses)} businesses")

    asyncio.run(_run())


@app.command()
def score(
    zip_code: str = typer.Option(..., "--zip", help="Chicago zip code to target"),
    niche: str = typer.Option(..., "--niche", help="Business niche to target"),
):
    """Run full scoring pipeline for a zip+niche."""
    niche_enum = _get_niche(niche)

    async def _run():
        from leadforge.db.session import async_session
        from leadforge.pipeline.scoring_pipeline import run_scoring_pipeline

        async with async_session() as session:
            typer.echo(f"Running scoring pipeline for {zip_code} ({niche})...")
            count = await run_scoring_pipeline(session, zip_code, niche_enum)
            typer.echo(f"Scored {count} businesses")

    asyncio.run(_run())


@app.command()
def context(
    zip_code: str = typer.Option(..., "--zip", help="Chicago zip code to target"),
    niche: str = typer.Option(..., "--niche", help="Business niche to target"),
):
    """Compute competitive context for a zip+niche."""
    niche_enum = _get_niche(niche)

    async def _run():
        from leadforge.db.session import async_session
        from leadforge.scoring.competitive_context import compute_competitive_context

        async with async_session() as session:
            typer.echo(f"Computing competitive context for {zip_code} ({niche})...")
            context = await compute_competitive_context(session, zip_code, niche_enum)
            await session.commit()
            typer.echo(
                f"Context computed: {context.total_competitors} competitors, saturation={context.saturation_index:.2f}"
            )

    asyncio.run(_run())


@app.command()
def outreach(
    zip_code: str = typer.Option(..., "--zip", help="Chicago zip code to target"),
    niche: str = typer.Option(..., "--niche", help="Business niche to target"),
    batch_size: int = typer.Option(10, "--batch-size", help="Max leads to process"),
    min_score: float = typer.Option(
        30.0, "--min-score", help="Minimum composite score"
    ),
    dry_run: bool = typer.Option(
        False, "--dry-run", help="Generate briefs without calling"
    ),
):
    """Run outreach pipeline: select leads → queue → brief → call."""
    niche_enum = _get_niche(niche)

    async def _run():
        from leadforge.db.session import async_session
        from leadforge.pipeline.outreach_pipeline import run_outreach_pipeline

        async with async_session() as session:
            typer.echo(f"Running outreach pipeline for {zip_code} ({niche})...")
            if dry_run:
                typer.echo("(DRY RUN - no calls will be made)")
            records = await run_outreach_pipeline(
                session,
                zip_code,
                niche_enum,
                batch_size=batch_size,
                min_score=min_score,
                dry_run=dry_run,
            )
            typer.echo(f"Processed {len(records)} outreach records")
            for rec in records[:10]:
                typer.echo(f"  - Business {rec.business_id}: {rec.status.value}")

    asyncio.run(_run())


@app.command(name="call-status")
def call_status(
    call_id: Optional[str] = typer.Option(
        None, "--call-id", help="Retell call ID to check"
    ),
    zip_code: Optional[str] = typer.Option(None, "--zip", help="Filter by zip code"),
):
    """Check status of outreach calls."""

    async def _run():
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload

        from leadforge.db.models.business import Business
        from leadforge.db.models.outreach_record import OutreachRecord
        from leadforge.db.session import async_session

        async with async_session() as session:
            query = select(OutreachRecord).options(
                selectinload(OutreachRecord.business)
            )
            if call_id:
                query = query.where(OutreachRecord.retell_call_id == call_id)
            if zip_code:
                query = query.join(Business).where(Business.zip_code == zip_code)

            result = await session.execute(
                query.order_by(OutreachRecord.created_at.desc()).limit(20)
            )
            records = result.scalars().all()

            if not records:
                typer.echo("No outreach records found.")
                return

            typer.echo(f"Found {len(records)} outreach records:")
            for rec in records:
                biz_name = rec.business.name if rec.business else "Unknown"
                typer.echo(
                    f"  [{rec.status.value}] {biz_name} | "
                    f"Attempts: {rec.call_attempts} | "
                    f"Sentiment: {rec.call_sentiment_score or 'N/A'} | "
                    f"Call ID: {rec.retell_call_id or 'N/A'}"
                )

    asyncio.run(_run())


if __name__ == "__main__":
    app()
