# CoreTrace service — uv builder, CPU-only torch. Targets: dev | prod.
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS base
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

FROM base AS deps
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

FROM deps AS dev
COPY . .
EXPOSE 8000
CMD ["uv", "run", "--no-dev", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

FROM deps AS prod
COPY . .
ENV PATH="/app/.venv/bin:$PATH" CORETRACE_WORK=/work
EXPOSE 8000
# One process: the worker takes one job at a time, and the models hold about 1 GB.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
