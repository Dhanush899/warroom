"""The replay learns from September only; October incidents stay open for live demos."""
from __future__ import annotations

from app.config import ROOT
from app.memory import LocalBackend, MemoryService
from app.service import WarRoom, _in_month
from app.store import Store


def war_room(tmp_path) -> WarRoom:
    return WarRoom(Store(ROOT / "data", tmp_path / "state.json"), MemoryService(LocalBackend(tmp_path / "mem.json")))


def test_dataset_has_open_october_incidents():
    store = Store(ROOT / "data", ROOT / "var" / "_unused_state.json")
    october = [i for i in store.incidents if i["started_at"].startswith("2026-10")]
    assert len(october) >= 5 and all(not _in_month(i) for i in october)
    assert all(i["id"] in store.ground_truth for i in october)


def test_replay_never_touches_october(tmp_path):
    svc = war_room(tmp_path)
    todo_ids = {i["id"] for i in svc.store.incidents if _in_month(i) and i["day"] <= 30}
    assert not any(i.startswith("INC-10") for i in todo_ids)
    assert svc.metrics()["totals"]["incidents"] == len(todo_ids) == 58
