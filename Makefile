.PHONY: dev migrate test lint format

dev:
	docker compose up -d db redis

migrate:
	uv run alembic upgrade head

test:
	uv run pytest tests/ -v --cov=leadforge

lint:
	uv run ruff check src/ tests/ && uv run ruff format --check src/ tests/

format:
	uv run ruff format src/ tests/
