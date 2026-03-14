"""add outreach records table

Revision ID: 003
Revises: 002
Create Date: 2026-03-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '003'
down_revision: Union[str, None] = '002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create enum types for outreach pipeline
    op.execute("""
        CREATE TYPE pipelinestage AS ENUM (
            'scored', 'queued', 'contacted', 'voicemail', 'engaged',
            'meeting_scheduled', 'proposal_sent', 'negotiating',
            'won', 'lost', 'disqualified', 'nurture'
        )
    """)

    op.execute("""
        CREATE TYPE calldisposition AS ENUM (
            'answered', 'voicemail', 'no_answer', 'wrong_number'
        )
    """)

    op.execute("""
        CREATE TYPE meetingtype AS ENUM (
            'virtual', 'in_person'
        )
    """)

    # Create outreach_records table
    op.create_table(
        'outreach_records',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),

        # Foreign key
        sa.Column('business_id', postgresql.UUID(as_uuid=True), nullable=False),

        # Pipeline status
        sa.Column('status', postgresql.ENUM(name='pipelinestage', create_type=False), nullable=False),

        # Retell integration
        sa.Column('retell_call_id', sa.String(255), nullable=True),

        # Contact info
        sa.Column('first_contact_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_contact_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('contact_method', sa.String(20), nullable=True),

        # Call data
        sa.Column('call_transcript', sa.Text(), nullable=True),
        sa.Column('call_sentiment_score', sa.Float(), nullable=True),
        sa.Column('call_disposition', postgresql.ENUM(name='calldisposition', create_type=False), nullable=True),
        sa.Column('call_attempts', sa.Integer(), default=0, nullable=False),

        # Meeting
        sa.Column('meeting_scheduled', sa.Boolean(), default=False, nullable=False),
        sa.Column('meeting_type', postgresql.ENUM(name='meetingtype', create_type=False), nullable=True),
        sa.Column('meeting_datetime', sa.DateTime(timezone=True), nullable=True),

        # Follow-up
        sa.Column('follow_up_count', sa.Integer(), default=0, nullable=False),
        sa.Column('assigned_to', sa.String(255), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),

        # Financials
        sa.Column('proposal_amount', sa.Float(), nullable=True),
        sa.Column('contract_amount', sa.Float(), nullable=True),
        sa.Column('lost_reason', sa.String(500), nullable=True),

        # Foreign key constraint
        sa.ForeignKeyConstraint(['business_id'], ['businesses.id'], ondelete='CASCADE'),
    )

    # Create indexes
    op.create_index('ix_outreach_records_business_id', 'outreach_records', ['business_id'])
    op.create_index('ix_outreach_records_status', 'outreach_records', ['status'])
    op.create_index('ix_outreach_records_retell_call_id', 'outreach_records', ['retell_call_id'])
    op.create_index('ix_outreach_records_meeting_datetime', 'outreach_records', ['meeting_datetime'])


def downgrade() -> None:
    # Drop indexes
    op.drop_index('ix_outreach_records_meeting_datetime', table_name='outreach_records')
    op.drop_index('ix_outreach_records_retell_call_id', table_name='outreach_records')
    op.drop_index('ix_outreach_records_status', table_name='outreach_records')
    op.drop_index('ix_outreach_records_business_id', table_name='outreach_records')

    # Drop table
    op.drop_table('outreach_records')

    # Drop enum types
    op.execute('DROP TYPE meetingtype')
    op.execute('DROP TYPE calldisposition')
    op.execute('DROP TYPE pipelinestage')
