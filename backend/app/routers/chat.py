import asyncio

from fastapi import APIRouter, Depends
from supabase import Client

from app.ai.support import generate_support_response
from app.db import get_supabase
from app.deps import CurrentUser, require_employee
from app.models.schemas import ChatRequest, ChatResponse

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("", response_model=ChatResponse)
async def employee_support_chat(
    payload: ChatRequest,
    employee: CurrentUser = Depends(require_employee),
    supabase: Client = Depends(get_supabase),
) -> ChatResponse:
    """Answer an employee's HR question using profile context and Knowledge Base search."""
    response_text = await asyncio.to_thread(
        generate_support_response,
        payload.message,
        employee,
        supabase,
    )
    return ChatResponse(response=response_text)
