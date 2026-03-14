import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from leadforge.db.models.business import Business
from leadforge.scrapers.angi import AngiClient
from leadforge.scrapers.apify_meta import ApifyMetaClient
from leadforge.scrapers.craigslist import CraigslistClient
from leadforge.scrapers.nextdoor import NextdoorClient
from leadforge.scrapers.pagespeed import PageSpeedClient
from leadforge.scrapers.thumbtack import ThumbtackClient
from leadforge.scrapers.whois_dns import check_domain
from leadforge.scrapers.yelp import YelpClient

logger = structlog.get_logger()


async def enrich_business(session: AsyncSession, business: Business) -> None:
    """Run all enrichment scrapers for a single business.

    Each scraper is independent — failures are logged but don't stop others.
    """
    dp = business.digital_presence
    if dp is None:
        logger.warning("no_digital_presence", business_id=str(business.id))
        return

    location = f"{business.address}, Chicago, IL {business.zip_code}"

    # Yelp enrichment
    try:
        async with YelpClient() as yelp:
            yelp_data = await yelp.search_business(business.name, location)
            if yelp_data:
                dp.yelp_review_count = yelp_data.get("yelp_review_count")
                dp.yelp_rating = yelp_data.get("yelp_rating")
                logger.info("yelp_enriched", business=business.name)
    except Exception as e:
        logger.warning("yelp_enrichment_failed", business=business.name, error=str(e))

    # PageSpeed enrichment (if website exists)
    if dp.has_website and dp.website_url:
        try:
            async with PageSpeedClient() as pagespeed:
                ps_data = await pagespeed.analyze(dp.website_url)
                if ps_data:
                    dp.website_quality_score = ps_data.get("website_quality_score")
                    logger.info("pagespeed_enriched", business=business.name)
        except Exception as e:
            logger.warning(
                "pagespeed_enrichment_failed", business=business.name, error=str(e)
            )

    # WHOIS/DNS check (if website exists)
    if dp.has_website and dp.website_url:
        try:
            from urllib.parse import urlparse

            domain = urlparse(dp.website_url).netloc or dp.website_url
            domain = domain.replace("www.", "")
            dns_data = check_domain(domain)
            dp.has_ssl = dns_data.get("has_ssl", False)
            logger.info("whois_enriched", business=business.name)
        except Exception as e:
            logger.warning(
                "whois_enrichment_failed", business=business.name, error=str(e)
            )

    # Thumbtack
    try:
        async with ThumbtackClient() as thumbtack:
            tt_data = await thumbtack.search_business(business.name, business.zip_code)
            if tt_data and tt_data.get("thumbtack_hires"):
                business.thumbtack_hires = tt_data.get("thumbtack_hires")
    except Exception as e:
        logger.warning(
            "thumbtack_enrichment_failed", business=business.name, error=str(e)
        )

    # Nextdoor (requires cookies, may not be available)
    try:
        async with NextdoorClient() as nextdoor:
            nd_data = await nextdoor.search_business(business.name, business.zip_code)
            if nd_data:
                business.nextdoor_recommendations = nd_data.get(
                    "nextdoor_recommendations", 0
                )
    except Exception as e:
        logger.warning(
            "nextdoor_enrichment_failed", business=business.name, error=str(e)
        )

    # Craigslist
    try:
        async with CraigslistClient() as cl:
            cl_data = await cl.search_services(business.name)
            # Craigslist data is informational, not stored in model directly
            if cl_data and cl_data.get("craigslist_has_presence"):
                logger.info("craigslist_presence_found", business=business.name)
    except Exception as e:
        logger.warning(
            "craigslist_enrichment_failed", business=business.name, error=str(e)
        )

    # Angi
    try:
        async with AngiClient() as angi:
            angi_data = await angi.search_business(business.name, business.zip_code)
            # Angi data is informational for now
            if angi_data:
                logger.info("angi_enriched", business=business.name)
    except Exception as e:
        logger.warning("angi_enrichment_failed", business=business.name, error=str(e))

    # Apify Meta (Instagram, Facebook, Ads)
    try:
        async with ApifyMetaClient() as apify:
            # Check Meta ads
            ads_data = await apify.get_meta_ads(business.name)
            if ads_data:
                dp.has_meta_ads = ads_data.get("has_meta_ads", False)
    except Exception as e:
        logger.warning("apify_enrichment_failed", business=business.name, error=str(e))

    await session.flush()
    logger.info(
        "enrichment_complete", business=business.name, business_id=str(business.id)
    )
