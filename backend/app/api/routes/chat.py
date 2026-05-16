import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.routes.auth import build_public_avatar_url, resolve_user
from app.db.models import DirectMessageRecord, FriendRequestRecord, FriendshipRecord, UserRecord
from app.db.session import get_db
from app.schemas.ai import (
    ChatCompletionRequest,
    ChatCompletionResponse,
    DirectAttachment,
    DirectMessageCreate,
    DirectMessageResponse,
    FriendProfile,
    FriendRequestResponse,
    FriendSummaryResponse,
    FriendshipResponse,
)
from app.services.ai.client import complete_chat
from app.services.ai.adapters import ProviderError


router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("", response_model=ChatCompletionResponse)
async def chat(request: ChatCompletionRequest) -> ChatCompletionResponse:
    try:
        return await complete_chat(request)
    except ProviderError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/friends", response_model=FriendSummaryResponse)
async def list_friends(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> FriendSummaryResponse:
    current_user = resolve_user(authorization, db)
    friendships = db.scalars(
        select(FriendshipRecord)
        .where(or_(FriendshipRecord.user_a_id == current_user.id, FriendshipRecord.user_b_id == current_user.id))
        .order_by(FriendshipRecord.created_at.desc()),
    ).all()
    incoming = db.scalars(
        select(FriendRequestRecord)
        .where(FriendRequestRecord.addressee_id == current_user.id, FriendRequestRecord.status == "pending")
        .order_by(FriendRequestRecord.created_at.desc()),
    ).all()
    outgoing = db.scalars(
        select(FriendRequestRecord)
        .where(FriendRequestRecord.requester_id == current_user.id, FriendRequestRecord.status == "pending")
        .order_by(FriendRequestRecord.created_at.desc()),
    ).all()
    return FriendSummaryResponse(
        friends=[
            FriendshipResponse(
                user=to_friend_profile(db.get(UserRecord, friendship.user_b_id if friendship.user_a_id == current_user.id else friendship.user_a_id)),
                created_at=friendship.created_at,
            )
            for friendship in friendships
            if db.get(UserRecord, friendship.user_b_id if friendship.user_a_id == current_user.id else friendship.user_a_id)
        ],
        incoming_requests=[to_friend_request(request, db) for request in incoming],
        outgoing_requests=[to_friend_request(request, db) for request in outgoing],
    )


@router.post("/friends/request/{user_id}", response_model=FriendRequestResponse)
async def request_friend(
    user_id: str,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> FriendRequestResponse:
    current_user = resolve_user(authorization, db)
    ensure_direct_peer(user_id, current_user.id, db, require_friendship=False)
    if are_friends(current_user.id, user_id, db):
        raise HTTPException(status_code=409, detail="Already friends.")

    reverse_request = db.scalar(
        select(FriendRequestRecord).where(
            FriendRequestRecord.requester_id == user_id,
            FriendRequestRecord.addressee_id == current_user.id,
            FriendRequestRecord.status == "pending",
        ),
    )
    if reverse_request:
        return accept_friend_request_record(reverse_request, db)

    existing = db.scalar(
        select(FriendRequestRecord).where(
            FriendRequestRecord.requester_id == current_user.id,
            FriendRequestRecord.addressee_id == user_id,
        ),
    )
    if existing:
        existing.status = "pending"
        existing.responded_at = None
        db.commit()
        db.refresh(existing)
        return to_friend_request(existing, db)

    request = FriendRequestRecord(requester_id=current_user.id, addressee_id=user_id, status="pending")
    db.add(request)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Friend request already exists.") from exc
    db.refresh(request)
    return to_friend_request(request, db)


@router.post("/friends/requests/{request_id}/accept", response_model=FriendRequestResponse)
async def accept_friend_request(
    request_id: int,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> FriendRequestResponse:
    current_user = resolve_user(authorization, db)
    request = get_pending_incoming_request(request_id, current_user.id, db)
    return accept_friend_request_record(request, db)


@router.post("/friends/requests/{request_id}/reject", response_model=FriendRequestResponse)
async def reject_friend_request(
    request_id: int,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> FriendRequestResponse:
    current_user = resolve_user(authorization, db)
    request = get_pending_incoming_request(request_id, current_user.id, db)
    request.status = "rejected"
    request.responded_at = datetime.utcnow()
    db.commit()
    db.refresh(request)
    return to_friend_request(request, db)


@router.delete("/friends/{user_id}")
async def remove_friend(
    user_id: str,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    current_user = resolve_user(authorization, db)
    friendship = find_friendship(current_user.id, user_id, db)
    if friendship:
        db.delete(friendship)
        db.commit()
    return {"status": "ok"}


@router.get("/direct/{user_id}", response_model=list[DirectMessageResponse])
async def list_direct_messages(
    user_id: str,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> list[DirectMessageResponse]:
    current_user = resolve_user(authorization, db)
    ensure_direct_peer(user_id, current_user.id, db)
    messages = db.scalars(
        select(DirectMessageRecord)
        .where(
            or_(
                and_(DirectMessageRecord.sender_id == current_user.id, DirectMessageRecord.recipient_id == user_id),
                and_(DirectMessageRecord.sender_id == user_id, DirectMessageRecord.recipient_id == current_user.id),
            ),
        )
        .order_by(DirectMessageRecord.created_at.asc(), DirectMessageRecord.id.asc())
        .limit(300),
    ).all()
    return [to_direct_message(message) for message in messages]


@router.post("/direct/{user_id}", response_model=DirectMessageResponse)
async def send_direct_message(
    user_id: str,
    request: DirectMessageCreate,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> DirectMessageResponse:
    current_user = resolve_user(authorization, db)
    ensure_direct_peer(user_id, current_user.id, db)
    attachments = request.attachments[:4]
    message = DirectMessageRecord(
        sender_id=current_user.id,
        recipient_id=user_id,
        content=request.content.strip(),
        attachments_json=json.dumps([attachment.model_dump() for attachment in attachments], ensure_ascii=False),
    )
    db.add(message)
    db.commit()
    db.refresh(message)
    return to_direct_message(message)


def ensure_direct_peer(user_id: str, current_user_id: str, db: Session, require_friendship: bool = True) -> UserRecord:
    if user_id == current_user_id:
        raise HTTPException(status_code=400, detail="Cannot send a direct message to yourself.")
    user = db.get(UserRecord, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if require_friendship and not are_friends(current_user_id, user_id, db):
        raise HTTPException(status_code=403, detail="Friend approval is required before messaging.")
    return user


def get_pending_incoming_request(request_id: int, current_user_id: str, db: Session) -> FriendRequestRecord:
    request = db.get(FriendRequestRecord, request_id)
    if not request or request.addressee_id != current_user_id or request.status != "pending":
        raise HTTPException(status_code=404, detail="Friend request not found.")
    return request


def accept_friend_request_record(request: FriendRequestRecord, db: Session) -> FriendRequestResponse:
    request.status = "accepted"
    request.responded_at = datetime.utcnow()
    if not find_friendship(request.requester_id, request.addressee_id, db):
        user_a_id, user_b_id = friend_pair(request.requester_id, request.addressee_id)
        db.add(FriendshipRecord(user_a_id=user_a_id, user_b_id=user_b_id))
    db.commit()
    db.refresh(request)
    return to_friend_request(request, db)


def friend_pair(left_id: str, right_id: str) -> tuple[str, str]:
    return tuple(sorted((left_id, right_id)))  # type: ignore[return-value]


def find_friendship(left_id: str, right_id: str, db: Session) -> Optional[FriendshipRecord]:
    user_a_id, user_b_id = friend_pair(left_id, right_id)
    return db.scalar(
        select(FriendshipRecord).where(FriendshipRecord.user_a_id == user_a_id, FriendshipRecord.user_b_id == user_b_id),
    )


def are_friends(left_id: str, right_id: str, db: Session) -> bool:
    return find_friendship(left_id, right_id, db) is not None


def to_friend_profile(user: Optional[UserRecord]) -> FriendProfile:
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    return FriendProfile(
        id=user.id,
        username=user.username,
        email=user.email,
        display_name=user.display_name,
        status="active",
        bio="",
        avatar_url=build_public_avatar_url(user.avatar_path),
    )


def to_friend_request(request: FriendRequestRecord, db: Session) -> FriendRequestResponse:
    return FriendRequestResponse(
        id=request.id,
        requester=to_friend_profile(db.get(UserRecord, request.requester_id)),
        addressee=to_friend_profile(db.get(UserRecord, request.addressee_id)),
        status=request.status,
        created_at=request.created_at,
        responded_at=request.responded_at,
    )


def to_direct_message(message: DirectMessageRecord) -> DirectMessageResponse:
    return DirectMessageResponse(
        id=message.id,
        sender_id=message.sender_id,
        recipient_id=message.recipient_id,
        content=message.content,
        attachments=parse_attachments(message.attachments_json),
        created_at=message.created_at,
    )


def parse_attachments(raw: Optional[str]) -> list[DirectAttachment]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    attachments: list[DirectAttachment] = []
    for item in parsed[:4]:
        if isinstance(item, dict):
            try:
                attachments.append(DirectAttachment(**item))
            except ValueError:
                continue
    return attachments
