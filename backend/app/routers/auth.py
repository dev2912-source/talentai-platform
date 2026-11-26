from fastapi import APIRouter, Depends

from app.deps import CurrentUser, get_current_user
from app.models.schemas import UserProfileOut

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/me", response_model=UserProfileOut)
def get_me(current_user: CurrentUser = Depends(get_current_user)) -> UserProfileOut:
    """Return the authenticated user's profile."""
    return UserProfileOut.model_validate(current_user)
