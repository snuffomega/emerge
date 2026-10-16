.PHONY: setup backend frontend test typecheck docker

setup:
	cd backend && python -m venv .venv && .venv/bin/pip install -r requirements-local.txt
	cd frontend && yarn install

backend:
	cd backend && .venv/bin/uvicorn server:app --reload --port 8001

frontend:
	cd frontend && VITE_API_URL= WORKRATE_API_PROXY=http://localhost:8001 yarn dev

test:
	cd backend && .venv/bin/python -m pytest tests -q -n 0

typecheck:
	cd frontend && yarn tsc --noEmit

docker:
	docker compose up --build
