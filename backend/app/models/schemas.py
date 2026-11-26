from pydantic import BaseModel, ConfigDict


class HealthResponse(BaseModel):
    """Health check payload."""

    status: str = "ok"
    service: str = "talentai-backend"


class UserProfileOut(BaseModel):
    """Serialized authenticated user profile."""

    id: str
    email: str
    username: str
    is_hr: bool
    department: str
    salary: float
    leave_balance: int
    attendance_score: int

    model_config = ConfigDict(from_attributes=True)
