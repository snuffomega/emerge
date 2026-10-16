import os
import sys
import tempfile
from pathlib import Path

_tmp = tempfile.mkdtemp()
os.environ["WORKRATE_DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["WORKRATE_SEED_ON_EMPTY"] = "false"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from workrate.main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def seeded(client):
    r = client.post("/api/v1/demo/reset")
    assert r.status_code == 200
    return r.json()
