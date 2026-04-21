# Contributing

1. **Python:** use a virtualenv, `pip install -r requirements.txt`, `PYTHONPATH=src` for imports.
2. **Frontend:** from `frontend/`: `npm install`, `npm run dev`; set `NEXT_PUBLIC_API_BASE` to your API origin.
3. **Style:** match existing patterns; keep changes scoped to the issue or request.
4. **Branches & PRs:** short-lived feature branches; PR description should state behavior change in full sentences.
5. **Secrets:** never commit `.env` or API keys; copy `.env.example` / `frontend/.env.local.example`.

Thank you for improving MemeLab.
