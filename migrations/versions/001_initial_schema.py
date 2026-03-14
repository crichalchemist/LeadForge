"""initial schema

Revision ID: 001
Revises:
Create Date: 2026-03-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import geoalchemy2

# revision identifiers, used by Alembic.
revision: str = '001'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Enable PostGIS extension
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")

    # Create enum types
    op.execute("CREATE TYPE licensestatus AS ENUM ('active', 'expired', 'revoked', 'unknown')")
    op.execute("""
        CREATE TYPE nichetype AS ENUM (
            'septic_services', 'used_auto_parts', 'meat_markets', 'bars',
            'nail_salons', 'beauty_shops', 'smoke_shops', 'beauty_supply',
            'mobile_mechanics', 'tire_shops', 'lawn_services', 'towing',
            'barbershops', 'veterinarians', 'security_services'
        )
    """)

    # Create businesses table
    op.create_table(
        'businesses',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),

        # Core fields
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('address', sa.String(500), nullable=True),
        sa.Column('zip_code', sa.String(10), nullable=False),
        sa.Column('phone', sa.String(20), nullable=True),
        sa.Column('email', sa.String(255), nullable=True),
        sa.Column('owner_name', sa.String(255), nullable=True),
        sa.Column('niche', postgresql.ENUM(name='nichetype', create_type=False), nullable=False),

        # License/registration
        sa.Column('license_number', sa.String(50), nullable=True),
        sa.Column('license_status', postgresql.ENUM(name='licensestatus', create_type=False), nullable=True),
        sa.Column('license_issue_date', sa.Date(), nullable=True),
        sa.Column('incorporation_date', sa.Date(), nullable=True),

        # Business metrics
        sa.Column('employee_count_est', sa.Integer(), nullable=True),
        sa.Column('estimated_monthly_revenue', sa.Float(), nullable=True),

        # External IDs
        sa.Column('google_place_id', sa.String(255), nullable=True),

        # Social/platform metrics
        sa.Column('thumbtack_hires', sa.Integer(), nullable=True),
        sa.Column('nextdoor_recommendations', sa.Integer(), nullable=True),
        sa.Column('ig_location_tag_count', sa.Integer(), nullable=True),
        sa.Column('ig_hashtag_mention_count', sa.Integer(), nullable=True),
        sa.Column('fb_checkin_count', sa.Integer(), nullable=True),
        sa.Column('fb_ugc_tag_count', sa.Integer(), nullable=True),
        sa.Column('total_customer_ugc', sa.Integer(), nullable=True),

        # PostGIS geometry
        sa.Column('location', geoalchemy2.Geometry(geometry_type='POINT', srid=4326), nullable=True),
    )

    # Create indexes for businesses
    op.create_index('ix_businesses_zip_code', 'businesses', ['zip_code'])
    op.create_index('ix_businesses_niche', 'businesses', ['niche'])
    op.create_index('ix_businesses_google_place_id', 'businesses', ['google_place_id'], unique=True)

    # Create spatial index for location
    op.execute("CREATE INDEX IF NOT EXISTS idx_businesses_location ON businesses USING GIST (location)")

    # Create digital_presences table
    op.create_table(
        'digital_presences',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),

        sa.Column('business_id', postgresql.UUID(as_uuid=True), nullable=False),

        # Website
        sa.Column('has_website', sa.Boolean(), default=False, nullable=False),
        sa.Column('website_url', sa.String(500), nullable=True),
        sa.Column('website_quality_score', sa.Float(), nullable=True),
        sa.Column('has_ssl', sa.Boolean(), nullable=True),
        sa.Column('domain_registration_date', sa.String(50), nullable=True),

        # Google Business Profile
        sa.Column('has_google_business_profile', sa.Boolean(), default=False, nullable=False),
        sa.Column('gbp_completeness_score', sa.Float(), nullable=True),
        sa.Column('google_review_count', sa.Integer(), default=0, nullable=True),
        sa.Column('google_avg_rating', sa.Float(), nullable=True),
        sa.Column('review_velocity_30d', sa.Float(), nullable=True),

        # Social media
        sa.Column('has_facebook_page', sa.Boolean(), default=False, nullable=False),
        sa.Column('has_instagram', sa.Boolean(), default=False, nullable=False),
        sa.Column('fb_last_post_days_ago', sa.Integer(), nullable=True),
        sa.Column('ig_follower_count', sa.Integer(), nullable=True),
        sa.Column('ig_post_frequency', sa.Float(), nullable=True),

        # Advertising
        sa.Column('has_google_ads', sa.Boolean(), default=False, nullable=False),
        sa.Column('has_meta_ads', sa.Boolean(), default=False, nullable=False),

        # Yelp
        sa.Column('yelp_review_count', sa.Integer(), nullable=True),
        sa.Column('yelp_rating', sa.Float(), nullable=True),

        sa.ForeignKeyConstraint(['business_id'], ['businesses.id'], ondelete='CASCADE'),
    )

    # Create unique index for business_id
    op.create_index('ix_digital_presences_business_id', 'digital_presences', ['business_id'], unique=True)

    # Create lead_scores table
    op.create_table(
        'lead_scores',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),

        sa.Column('business_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('score_version', sa.Integer(), default=1, nullable=False),

        # Sub-scores
        sa.Column('digital_deficit_score', sa.Float(), nullable=True),
        sa.Column('viability_score', sa.Float(), nullable=True),
        sa.Column('competitive_pressure_score', sa.Float(), nullable=True),

        # Composite
        sa.Column('composite_acquisition_score', sa.Float(), nullable=True),

        # Price tier
        sa.Column('price_tier', sa.Integer(), nullable=True),

        # Sentiment adjustment
        sa.Column('sentiment_adjustment', sa.Float(), nullable=True),

        sa.ForeignKeyConstraint(['business_id'], ['businesses.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('business_id', 'score_version', name='uq_business_score_version'),
    )

    # Create index for business_id on lead_scores
    op.create_index('ix_lead_scores_business_id', 'lead_scores', ['business_id'])


def downgrade() -> None:
    # Drop tables
    op.drop_index('ix_lead_scores_business_id', table_name='lead_scores')
    op.drop_table('lead_scores')

    op.drop_index('ix_digital_presences_business_id', table_name='digital_presences')
    op.drop_table('digital_presences')

    op.execute("DROP INDEX IF EXISTS idx_businesses_location")
    op.drop_index('ix_businesses_google_place_id', table_name='businesses')
    op.drop_index('ix_businesses_niche', table_name='businesses')
    op.drop_index('ix_businesses_zip_code', table_name='businesses')
    op.drop_table('businesses')

    # Drop enum types
    op.execute("DROP TYPE nichetype")
    op.execute("DROP TYPE licensestatus")

    # Note: We don't drop PostGIS extension as it might be used by other applications
