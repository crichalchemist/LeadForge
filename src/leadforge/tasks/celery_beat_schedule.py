from celery.schedules import crontab

CELERY_BEAT_SCHEDULE = {
    "recalibrate-all-businesses-quarterly": {
        "task": "leadforge.tasks.recalibration_tasks.recalibrate_all_businesses",
        "schedule": crontab(
            minute=0,
            hour=2,
            day_of_month=1,
            month_of_year="1,4,7,10",
        ),
        "options": {"queue": "recalibration"},
    },
}
