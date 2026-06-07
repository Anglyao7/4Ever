from __future__ import annotations

import json
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.auth import public_media_url, require_user
from app.config import Settings
from app.database import Database, json_dumps, json_loads, now_iso, row_to_dict
from app.providers import ChatAttachmentUploadRequest, load_chat_attachment_record, sign_chat_attachment_url, store_chat_attachment


class DirectAttachment(BaseModel):
    id: str
    name: str
    type: str
    size: int
    kind: str
    data_url: str | None = None
    uploaded: bool | None = False


class DirectMessageCreate(BaseModel):
    content: str = ""
    attachments: list[DirectAttachment] = Field(default_factory=list)
    reply_to_message_id: int | None = None


def router(db: Database, settings: Settings | None = None) -> APIRouter:
    api = APIRouter(prefix="/api/chat")
    runtime_settings = settings or db.settings

    @api.get("/friends")
    def list_friends(request: Request) -> dict[str, Any]:
        user = require_user(request, db)
        with db.connect() as conn:
            friendships = conn.execute(
                "SELECT * FROM friendships WHERE user_a_id = ? OR user_b_id = ? ORDER BY created_at DESC",
                (user["id"], user["id"]),
            ).fetchall()
            incoming = conn.execute(
                "SELECT * FROM friend_requests WHERE addressee_id = ? AND status = 'pending' ORDER BY created_at DESC",
                (user["id"],),
            ).fetchall()
            outgoing = conn.execute(
                "SELECT * FROM friend_requests WHERE requester_id = ? AND status = 'pending' ORDER BY created_at DESC",
                (user["id"],),
            ).fetchall()
        return {
            "friends": [friendship_response(db, row_to_dict(row) or {}, user["id"]) for row in friendships],
            "incoming_requests": [friend_request_response(db, row_to_dict(row) or {}) for row in incoming],
            "outgoing_requests": [friend_request_response(db, row_to_dict(row) or {}) for row in outgoing],
        }

    @api.post("/friends/request/{user_id}")
    def request_friend(request: Request, user_id: str) -> dict[str, Any]:
        user = require_user(request, db)
        ensure_direct_peer(db, user_id, user["id"], require_friendship=False)
        if are_friends(db, user["id"], user_id):
            raise HTTPException(status_code=409, detail="Already friends.")
        with db.connect() as conn:
            reverse = row_to_dict(
                conn.execute(
                    "SELECT * FROM friend_requests WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'",
                    (user_id, user["id"]),
                ).fetchone()
            )
            if reverse:
                return accept_friend_request_record(conn, db, reverse)
            now = now_iso()
            existing = row_to_dict(
                conn.execute(
                    "SELECT * FROM friend_requests WHERE requester_id = ? AND addressee_id = ?",
                    (user["id"], user_id),
                ).fetchone()
            )
            if existing:
                conn.execute("UPDATE friend_requests SET status = 'pending', responded_at = NULL WHERE id = ?", (existing["id"],))
                request_row = row_to_dict(conn.execute("SELECT * FROM friend_requests WHERE id = ?", (existing["id"],)).fetchone())
                return friend_request_response(db, request_row or {})
            cursor = conn.execute(
                "INSERT INTO friend_requests (requester_id, addressee_id, status, created_at) VALUES (?, ?, 'pending', ?)",
                (user["id"], user_id, now),
            )
            request_row = row_to_dict(conn.execute("SELECT * FROM friend_requests WHERE id = ?", (cursor.lastrowid,)).fetchone())
        return friend_request_response(db, request_row or {})

    @api.post("/friends/requests/{request_id}/accept")
    def accept_request(request: Request, request_id: int) -> dict[str, Any]:
        user = require_user(request, db)
        with db.connect() as conn:
            record = pending_incoming_request(conn, request_id, user["id"])
            return accept_friend_request_record(conn, db, record)

    @api.post("/friends/requests/{request_id}/reject")
    def reject_request(request: Request, request_id: int) -> dict[str, Any]:
        user = require_user(request, db)
        with db.connect() as conn:
            record = pending_incoming_request(conn, request_id, user["id"])
            now = now_iso()
            conn.execute("UPDATE friend_requests SET status = 'rejected', responded_at = ? WHERE id = ?", (now, request_id))
            updated = row_to_dict(conn.execute("SELECT * FROM friend_requests WHERE id = ?", (request_id,)).fetchone())
        return friend_request_response(db, updated or {})

    @api.delete("/friends/{user_id}")
    def remove_friend(request: Request, user_id: str) -> dict[str, str]:
        user = require_user(request, db)
        left, right = friend_pair(user["id"], user_id)
        with db.connect() as conn:
            conn.execute("DELETE FROM friendships WHERE user_a_id = ? AND user_b_id = ?", (left, right))
        return {"status": "ok"}

    @api.get("/direct/{user_id}")
    def list_direct_messages(request: Request, user_id: str) -> list[dict[str, Any]]:
        user = require_user(request, db)
        ensure_direct_peer(db, user_id, user["id"], require_friendship=True)
        with db.connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM direct_messages
                WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
                ORDER BY created_at ASC, id ASC
                LIMIT 300
                """,
                (user["id"], user_id, user_id, user["id"]),
            ).fetchall()
        return [direct_message_response(row_to_dict(row) or {}, runtime_settings, db) for row in rows]

    @api.post("/direct/{user_id}")
    def send_direct_message(request: Request, user_id: str, payload: DirectMessageCreate) -> dict[str, Any]:
        user = require_user(request, db)
        ensure_direct_peer(db, user_id, user["id"], require_friendship=True)
        content = payload.content.strip()
        attachments = normalize_direct_attachments(runtime_settings, db, str(user["id"]), payload.attachments[:4])
        if not content and not attachments:
            raise HTTPException(status_code=422, detail="Message content or attachment is required.")
        if len(content) > 20000:
            raise HTTPException(status_code=422, detail="Message content must be 20000 characters or fewer.")
        reply_preview = None
        reply_id = payload.reply_to_message_id
        with db.connect() as conn:
            if reply_id is not None:
                target = ensure_reply_target(conn, reply_id, user["id"], user_id)
                reply_preview = json_dumps(direct_reply_preview(target, user["id"]))
            now = now_iso()
            cursor = conn.execute(
                """
                INSERT INTO direct_messages (sender_id, recipient_id, content, attachments_json, reply_to_message_id, reply_to_preview_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (user["id"], user_id, content, json_dumps(attachments), reply_id, reply_preview, now),
            )
            message = row_to_dict(conn.execute("SELECT * FROM direct_messages WHERE id = ?", (cursor.lastrowid,)).fetchone())
        return direct_message_response(message or {}, runtime_settings, db)

    return api


def ensure_direct_peer(db: Database, peer_id: str, current_id: str, require_friendship: bool) -> dict[str, Any]:
    if peer_id == current_id:
        raise HTTPException(status_code=400, detail="Cannot send a direct message to yourself.")
    peer = user_by_id(db, peer_id)
    if not peer:
        raise HTTPException(status_code=404, detail="User not found.")
    if require_friendship and not are_friends(db, current_id, peer_id):
        raise HTTPException(status_code=403, detail="Friend approval is required before messaging.")
    return peer


def user_by_id(db: Database, user_id: str) -> dict[str, Any] | None:
    with db.connect() as conn:
        return row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())


def are_friends(db: Database, left_id: str, right_id: str) -> bool:
    left, right = friend_pair(left_id, right_id)
    with db.connect() as conn:
        count = conn.execute("SELECT COUNT(*) AS count FROM friendships WHERE user_a_id = ? AND user_b_id = ?", (left, right)).fetchone()["count"]
    return count > 0


def pending_incoming_request(conn, request_id: int, current_id: str) -> dict[str, Any]:
    record = row_to_dict(conn.execute("SELECT * FROM friend_requests WHERE id = ?", (request_id,)).fetchone())
    if not record or record["addressee_id"] != current_id or record["status"] != "pending":
        raise HTTPException(status_code=404, detail="Friend request not found.")
    return record


def accept_friend_request_record(conn, db: Database, record: dict[str, Any]) -> dict[str, Any]:
    now = now_iso()
    left, right = friend_pair(record["requester_id"], record["addressee_id"])
    conn.execute("UPDATE friend_requests SET status = 'accepted', responded_at = ? WHERE id = ?", (now, record["id"]))
    exists = conn.execute("SELECT 1 FROM friendships WHERE user_a_id = ? AND user_b_id = ?", (left, right)).fetchone()
    if not exists:
        conn.execute("INSERT INTO friendships (user_a_id, user_b_id, created_at) VALUES (?, ?, ?)", (left, right, now))
    updated = row_to_dict(conn.execute("SELECT * FROM friend_requests WHERE id = ?", (record["id"],)).fetchone())
    return friend_request_response(db, updated or {})


def friendship_response(db: Database, friendship: dict[str, Any], current_id: str) -> dict[str, Any]:
    peer_id = friendship["user_b_id"] if friendship["user_a_id"] == current_id else friendship["user_a_id"]
    return {"user": friend_profile(user_by_id(db, peer_id)), "created_at": friendship["created_at"]}


def friend_request_response(db: Database, record: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": record["id"],
        "requester": friend_profile(user_by_id(db, record["requester_id"])),
        "addressee": friend_profile(user_by_id(db, record["addressee_id"])),
        "status": record["status"],
        "created_at": record["created_at"],
        "responded_at": record.get("responded_at"),
    }


def friend_profile(user: dict[str, Any] | None) -> dict[str, Any]:
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    return {
        "id": user["id"],
        "username": user["username"],
        "email": user["email"],
        "display_name": user["display_name"],
        "status": "active",
        "bio": user.get("bio") or "",
        "location": user.get("location") or "",
        "avatar_url": public_media_url(user.get("avatar_path")),
        "cover_url": public_media_url(user.get("cover_path")),
    }


def direct_message_response(message: dict[str, Any], settings: Settings, db: Database) -> dict[str, Any]:
    return {
        "id": message["id"],
        "sender_id": message["sender_id"],
        "recipient_id": message["recipient_id"],
        "content": message.get("content") or "",
        "attachments": [
            direct_attachment_response(settings, db, str(message["sender_id"]), attachment)
            for attachment in parse_attachments(message.get("attachments_json"))
        ],
        "reply_to_message_id": message.get("reply_to_message_id"),
        "reply_to": json_loads(message.get("reply_to_preview_json"), None),
        "created_at": message.get("created_at") or "",
    }


def normalize_direct_attachments(settings: Settings, db: Database, user_id: str, attachments: list[DirectAttachment]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for attachment in attachments:
        if attachment.size < 0:
            raise HTTPException(status_code=422, detail="Attachment size must be greater than or equal to 0.")
        data_url = (attachment.data_url or "").strip()
        if attachment.uploaded:
            row = load_chat_attachment_record(db, user_id, attachment.id)
            if not row:
                raise HTTPException(status_code=404, detail="Attachment not found.")
            normalized.append(direct_attachment_from_record(row))
            continue
        if data_url:
            uploaded = store_direct_data_url_attachment(settings, db, user_id, attachment, data_url)
            normalized.append(direct_attachment_from_record(uploaded))
            continue
        normalized.append(
            {
                "id": attachment.id[:120],
                "name": attachment.name[:240],
                "type": attachment.type[:120],
                "size": attachment.size,
                "kind": "image" if attachment.kind == "image" else "file",
                "uploaded": False,
            }
        )
    return normalized


def store_direct_data_url_attachment(settings: Settings, db: Database, user_id: str, attachment: DirectAttachment, data_url: str) -> dict[str, Any]:
    if not data_url.startswith("data:") or "," not in data_url:
        raise HTTPException(status_code=422, detail="Attachment data URL is invalid.")
    header, data_base64 = data_url.split(",", 1)
    if ";base64" not in header.lower():
        raise HTTPException(status_code=422, detail="Attachment data URL must be base64 encoded.")
    content_type = header[5:].split(";", 1)[0].strip().lower() or attachment.type
    return store_chat_attachment(
        settings,
        db,
        user_id,
        ChatAttachmentUploadRequest(filename=attachment.name, content_type=content_type, data_base64=data_base64),
    )


def direct_attachment_from_record(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(record.get("id") or "")[:120],
        "name": str(record.get("name") or "")[:240],
        "type": str(record.get("content_type") or record.get("type") or "application/octet-stream")[:120],
        "size": int(record.get("size") or 0),
        "kind": "image" if str(record.get("kind") or "") == "image" else "file",
        "uploaded": True,
    }


def direct_attachment_response(settings: Settings, db: Database, owner_id: str, attachment: dict[str, Any]) -> dict[str, Any]:
    if attachment.get("uploaded"):
        row = load_chat_attachment_record(db, owner_id, str(attachment.get("id") or ""))
        if row:
            out = direct_attachment_from_record(row)
            out["data_url"] = direct_attachment_temporary_url(settings, owner_id, out["id"])
            return out
    return {
        "id": str(attachment.get("id") or "")[:120],
        "name": str(attachment.get("name") or "")[:240],
        "type": str(attachment.get("type") or "application/octet-stream")[:120],
        "size": int(attachment.get("size") or 0),
        "kind": "image" if str(attachment.get("kind") or "") == "image" else "file",
        "data_url": str(attachment.get("data_url") or "") or None,
        "uploaded": bool(attachment.get("uploaded")),
    }


def direct_attachment_temporary_url(settings: Settings, owner_id: str, attachment_id: str) -> str:
    ttl = max(60, min(int(settings.chat_attachment_url_ttl_seconds or 600), 3600))
    expires_at = int(time.time()) + ttl
    token = sign_chat_attachment_url(settings, owner_id, attachment_id, expires_at)
    return f"/api/chat/attachments/{attachment_id}/temporary?token={token}"


def parse_attachments(raw: Any) -> list[dict[str, Any]]:
    items = json_loads(raw, [])
    return items[:4] if isinstance(items, list) else []


def ensure_reply_target(conn, message_id: int, current_id: str, peer_id: str) -> dict[str, Any]:
    message = row_to_dict(conn.execute("SELECT * FROM direct_messages WHERE id = ?", (message_id,)).fetchone())
    if not message:
        raise HTTPException(status_code=404, detail="Reply target was not found.")
    if not ((message["sender_id"] == current_id and message["recipient_id"] == peer_id) or (message["sender_id"] == peer_id and message["recipient_id"] == current_id)):
        raise HTTPException(status_code=400, detail="Reply target is not in this conversation.")
    return message


def direct_reply_preview(message: dict[str, Any], current_id: str) -> dict[str, Any]:
    author_name = "You" if message["sender_id"] == current_id else "Contact"
    content = (message.get("content") or "").strip()
    if not content:
        attachments = parse_attachments(message.get("attachments_json"))
        content = str(attachments[0].get("name") or "Attachment") if attachments else "Attachment"
    return {"id": message["id"], "author_name": author_name, "content": content, "created_at": message.get("created_at"), "sender_id": message["sender_id"]}


def friend_pair(left: str, right: str) -> tuple[str, str]:
    values = sorted([left, right])
    return values[0], values[1]
