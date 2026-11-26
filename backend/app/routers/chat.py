import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client

from app.ai.support import generate_support_response
from app.db import get_supabase
from app.deps import CurrentUser, require_employee
from app.models.schemas import ChatRequest, ChatResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("", response_model=ChatResponse)
async def employee_support_chat(
    payload: ChatRequest,
    employee: CurrentUser = Depends(require_employee),
    supabase: Client = Depends(get_supabase),
) -> ChatResponse:
    """Answer an employee's HR question using profile context and Knowledge Base search."""
    try:
        response_text = await asyncio.to_thread(
            generate_support_response,
            payload.message,
            employee,
            supabase,
        )
    except Exception as exc:
        logger.exception("Support chat failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unable to generate support response right now.",
        ) from exc
    return ChatResponse(response=response_text)
