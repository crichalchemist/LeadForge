"""add competitive context table

Revision ID: 002
Revises: 001
Create Date: 2026-03-14 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '002'
down_revision: Union[str, None] = '001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.create_table(
        'competitive_contexts',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('zip_code', sa.String(10), nullable=False),
        sa.Column('niche', postgresql.ENUM(name='nichetype', create_type=False), nullable=False),
        sa.Column('competitor_count', sa.Integer(), default=0, nullable=False),
        sa.Column('avg_digital_score', sa.Float(), nullable=True),
        sa.Column('competitor_ads_active_count', sa.Integer(), default=0, nullable=False),
        sa.Column('avg_rating', sa.Float(), nullable=True),
        sa.Column('median_household_income', sa.Float(), nullable=True),
        sa.Column('population_density', sa.Float(), nullable=True),
        sa.UniqueConstraint('zip_code', 'niche', name='uq_zip_niche'),
    )
    op.create_index('ix_competitive_contexts_zip_code', 'competitive_contexts', ['zip_code'])

def downgrade() -> None:
    op.drop_index('ix_competitive_contexts_zip_code', table_name='competitive_contexts')
    op.drop_table('competitive_contexts')
