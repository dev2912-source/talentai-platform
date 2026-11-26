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


class TapDataOut(BaseModel):
    """Payload describing a recorded hardware attendance tap."""

    id: int | str
    employeeId: str
    tapType: str
    tapNumber: int
    timestamp: str
    deviceType: str
    location: str


class TapResponse(BaseModel):
    """Response returned by POST /api/attendance/tap."""

    status: str = "success"
    message: str
    data: TapDataOut


class AttendanceLogOut(BaseModel):
    """Serialized attendance hardware tap log row."""

    id: int | str
    employee_id: str
    timestamp: str
    device_type: str = "rfid_scanner"
    location: str = "Main Entrance"
    tap_type: str
    created_at: str | None = None


class AttendanceReportOut(BaseModel):
    """Serialized AI attendance analysis row."""

    id: str
    batch_id: str
    employee_name: str
    total_hours: float
    leaves_taken: int
    ai_score: int | None = None
    ai_feedback: str = ""
    created_at: str | None = None


class AttendanceReportBatchResponse(BaseModel):
    """Batch response for uploaded or fetched AI attendance reports."""

    batch_id: str | None = None
    reports: list[AttendanceReportOut] = Field(default_factory=list)


class PerformanceRecordOut(BaseModel):
    """Serialized AI performance review record."""

    id: str
    batch_id: str
    employee_id: str
    employee_name: str
    employee_email: str
    department: str = "General"
    review_period: str
    kpi_data: str
    performance_score: int | None = None
    kpi_achievement_percent: float | None = None
    strengths: str | None = ""
    areas_for_improvement: str | None = ""
    recommended_actions: str | None = ""
    created_at: str | None = None


class PerformanceBatchResponse(BaseModel):
    """Batch response for uploaded or fetched AI performance review records."""

    batch_id: str | None = None
    records: list[PerformanceRecordOut] = Field(default_factory=list)


class PolicyIn(BaseModel):
    """Payload for creating or updating a company policy."""

    model_config = ConfigDict(str_strip_whitespace=True)

    title: str = Field(..., min_length=1)
    content: str = Field(..., min_length=1)


class PolicyOut(BaseModel):
    """Serialized company policy record."""

    id: str
    title: str
    content: str
    last_updated: str | None = None


class FaqIn(BaseModel):
    """Payload for creating or updating a knowledge base FAQ."""

    model_config = ConfigDict(str_strip_whitespace=True)

    question: str = Field(..., min_length=1)
    answer: str = Field(..., min_length=1)


class FaqOut(BaseModel):
    """Serialized knowledge base FAQ record."""

    id: str
    question: str
    answer: str
    created_at: str | None = None


class KbOverviewResponse(BaseModel):
    """Knowledge base overview payload for HR management."""

    policies: list[PolicyOut] = Field(default_factory=list)
    faqs: list[FaqOut] = Field(default_factory=list)
    employees: list[UserProfileOut] = Field(default_factory=list)


class ChatRequest(BaseModel):
    """Employee support chat prompt payload."""

    model_config = ConfigDict(str_strip_whitespace=True)

    message: str = Field(..., min_length=1)


class ChatResponse(BaseModel):
    """Employee support chat response payload."""

    response: str
