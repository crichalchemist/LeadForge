from celery import Celery
from leadforge.config import settings
from leadforge.tasks.celery_beat_schedule import CELERY_BEAT_SCHEDULE

celery_app = Celery(
    "leadforge",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
)

celery_app.conf.update(
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="America/Chicago",
    task_track_started=True,
    task_default_queue="default",
    task_routes={
        "leadforge.tasks.enrichment_tasks.*": {"queue": "enrichment"},
        "leadforge.tasks.outreach_tasks.*": {"queue": "outreach"},
        "leadforge.tasks.sentiment_tasks.*": {"queue": "sentiment"},
        "leadforge.tasks.recalibration_tasks.*": {"queue": "recalibration"},
    },
    beat_schedule=CELERY_BEAT_SCHEDULE,
    broker_connection_retry_on_startup=True,
)
