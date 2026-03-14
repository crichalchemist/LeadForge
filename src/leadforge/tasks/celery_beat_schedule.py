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
    "refresh-nof-corridors-weekly": {
        "task": "leadforge.tasks.corridor_refresh_tasks.refresh_nof_corridors",
        "schedule": crontab(minute=0, hour=3, day_of_week=0),  # Sunday 3am
        "options": {"queue": "default"},
    },
}
