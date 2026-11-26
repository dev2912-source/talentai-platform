from pydantic import BaseModel, ConfigDict, Field


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


class CandidateOut(BaseModel):
    """Serialized recruitment candidate record."""

    id: str
    job_id: str
    name: str
    email: str | None = None
    match_score: float = 0.0
    matched_skills: str = ""
    interview_slot: str = "TBD"
    email_subject: str = ""
    email_body: str = ""
    resume_source: str = ""
    resume_storage_path: str = ""
    email_sent: bool = False
    status: str = "email_drafted"
    created_at: str | None = None


class JobPostingOut(BaseModel):
    """Serialized job posting record."""

    id: str
    title: str
    department: str = "Engineering"
    description: str
    required_skills: str = "Not specified"
    experience_years: int = 0
    status: str = "draft"
    created_by: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class JobPostingSummaryOut(JobPostingOut):
    """Job posting summary with candidate count for dashboard listing."""

    candidate_count: int = 0


class ScreenJobResponse(BaseModel):
    """Response returned after running the 4-node screening LangGraph."""

    job_id: str
    status: str = "pending_approval"
    candidates: list[CandidateOut] = Field(default_factory=list)


class JobDetailResponse(BaseModel):
    """Job posting detail plus its shortlisted/drafted candidates."""

    job: JobPostingOut
    candidates: list[CandidateOut] = Field(default_factory=list)


class CandidateDecisionIn(BaseModel):
    """HR HITL approval decision and edited email content for one candidate."""

    candidate_id: str
    approved: bool = True
    email_subject: str = ""
    email_body: str = ""
    interview_slot: str | None = None


class ApproveJobRequest(BaseModel):
    """HITL approval payload submitted from the approval screen."""

    decisions: list[CandidateDecisionIn]


class ApproveJobResponse(BaseModel):
    """Response summary after approving/rejecting candidates and dispatching emails."""

    job_id: str
    status: str = "approved"
    sent_count: int = 0
    rejected_count: int = 0
    candidates: list[CandidateOut] = Field(default_factory=list)
