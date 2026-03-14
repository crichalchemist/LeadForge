"""add NOF grant models and nof_eligibility_score

Revision ID: 351fccc103da
Revises: 003
Create Date: 2026-03-14 19:25:39.294853

"""
from typing import Sequence, Union

from alembic import op
import geoalchemy2
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '351fccc103da'
down_revision: Union[str, None] = '003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # NOF Corridors table
    op.create_table('nof_corridors',
        sa.Column('corridor_name', sa.String(length=255), nullable=False),
        sa.Column('corridor_type', sa.Enum('eligible', 'priority', name='corridortype'), nullable=False),
        sa.Column('geometry', geoalchemy2.types.Geometry(geometry_type='MULTILINESTRING', srid=4326), nullable=True),
        sa.Column('source_updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('fetched_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_nof_corridors_geometry ON nof_corridors USING gist (geometry)")

    # Grant Applications table
    op.create_table('grant_applications',
        sa.Column('business_id', sa.Uuid(), nullable=False),
        sa.Column('status', sa.Enum('eligibility_assessed', 'intake', 'applied', 'pipeline', 'finalist', 'stage_1_legal', 'stage_2_docs', 'stage_3_financing', 'stage_3_construction', 'stage_4_closing', 'stage_5_complete', 'alumnus', 'removed', name='nofstage'), nullable=False),
        sa.Column('applied_date', sa.Date(), nullable=True),
        sa.Column('finalist_date', sa.Date(), nullable=True),
        sa.Column('cal_issued_date', sa.Date(), nullable=True),
        sa.Column('completion_date', sa.Date(), nullable=True),
        sa.Column('alumnus_date', sa.Date(), nullable=True),
        sa.Column('total_project_cost', sa.Float(), nullable=True),
        sa.Column('base_grant_amount', sa.Float(), nullable=True),
        sa.Column('acquisition_cost', sa.Float(), nullable=True),
        sa.Column('acquisition_coverage_pct', sa.Float(), nullable=True),
        sa.Column('taf_amount', sa.Float(), nullable=True),
        sa.Column('owner_contribution', sa.Float(), nullable=True),
        sa.Column('financing_amount', sa.Float(), nullable=True),
        sa.Column('financing_verified', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('corridor_name', sa.String(length=255), nullable=True),
        sa.Column('corridor_type', sa.String(length=50), nullable=True),
        sa.Column('is_priority_corridor', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('gc_bid_amount', sa.Float(), nullable=True),
        sa.Column('project_description', sa.Text(), nullable=True),
        sa.Column('exterior_work_pct', sa.Float(), nullable=True),
        sa.Column('has_site_control', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('site_control_type', sa.String(length=50), nullable=True),
        sa.Column('assigned_to', sa.String(length=255), nullable=True),
        sa.Column('ta_provider', sa.String(length=255), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('lost_reason', sa.Text(), nullable=True),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['business_id'], ['businesses.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_grant_applications_business_id'), 'grant_applications', ['business_id'], unique=False)

    # Grant Documents table
    op.create_table('grant_documents',
        sa.Column('grant_application_id', sa.Uuid(), nullable=False),
        sa.Column('document_type', sa.Enum('site_control', 'gc_bid', 'bank_statement', 'architectural_drawings', 'business_plan', 'strategic_plan', 'economic_disclosure', 'scofflaw_clearance', 'permit', 'insurance', 'construction_timeline', 'completion_survey', 'waivers_of_lien', 'certificate_of_occupancy', name='documenttype'), nullable=False),
        sa.Column('is_mandatory', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='missing'),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('received_date', sa.Date(), nullable=True),
        sa.Column('reviewed_date', sa.Date(), nullable=True),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['grant_application_id'], ['grant_applications.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_grant_documents_grant_application_id'), 'grant_documents', ['grant_application_id'], unique=False)

    # Add nof_eligibility_score to lead_scores
    op.add_column('lead_scores', sa.Column('nof_eligibility_score', sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column('lead_scores', 'nof_eligibility_score')
    op.drop_index(op.f('ix_grant_documents_grant_application_id'), table_name='grant_documents')
    op.drop_table('grant_documents')
    op.drop_index(op.f('ix_grant_applications_business_id'), table_name='grant_applications')
    op.drop_table('grant_applications')
    op.drop_index('idx_nof_corridors_geometry', table_name='nof_corridors', postgresql_using='gist')
    op.drop_table('nof_corridors')
    op.execute("DROP TYPE IF EXISTS nofstage")
    op.execute("DROP TYPE IF EXISTS documenttype")
    op.execute("DROP TYPE IF EXISTS corridortype")
