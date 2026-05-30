import asyncio


_cancel_events: dict[str, asyncio.Event] = {}


def register_active_run(run_id: str) -> asyncio.Event:
    event = asyncio.Event()
    _cancel_events[run_id] = event
    return event


def unregister_active_run(run_id: str) -> None:
    _cancel_events.pop(run_id, None)


def request_active_run_cancel(run_id: str) -> bool:
    event = _cancel_events.get(run_id)
    if not event:
        return False
    event.set()
    return True


def is_cancel_requested(run_id: str) -> bool:
    event = _cancel_events.get(run_id)
    return bool(event and event.is_set())
