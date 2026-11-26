import logging
from typing import Any

from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import Runnable, RunnableLambda
from langchain_openai import ChatOpenAI

from app.config import get_settings

logger = logging.getLogger(__name__)


def profile_value(profile: Any, key: str, default: Any) -> Any:
    """Read a profile attribute from a dict row, CurrentUser, or Django-like profile object."""
    if isinstance(profile, dict):
        val = profile.get(key)
        return default if val is None else val
    val = getattr(profile, key, None)
    if val is None and key == "username" and hasattr(profile, "user"):
        val = getattr(profile.user, "username", None)
    return default if val is None else val


def as_runnable_llm(llm: Any, *, raw_content: bool = False) -> Runnable:
    """Wrap duck-typed LLMs with `.invoke()` so LCEL chains work uniformly."""
    if isinstance(llm, Runnable):
        return llm

    def _invoke(prompt_value: Any) -> Any:
        messages = prompt_value.to_messages() if hasattr(prompt_value, "to_messages") else prompt_value
        res = llm.invoke(messages)
        return str(getattr(res, "content", res)) if raw_content else res

    return RunnableLambda(_invoke)


def get_llm(temperature: float = 0.2) -> ChatOpenAI:
    """Create a ChatOpenAI instance pointed at OpenRouter."""
    settings = get_settings()
    api_key = settings.OPENROUTER_API_KEY
    base_url = settings.OPENROUTER_BASE_URL
    model = settings.OPENROUTER_MODEL

    if not api_key:
        logger.warning(
            "OPENROUTER_API_KEY is not set. LLM calls will fail. "
            "Set it in your .env or environment."
        )

    return ChatOpenAI(
        api_key=api_key or "not-configured",
        base_url=base_url,
        model=model,
        temperature=temperature,
        max_tokens=4096,
    )


SCREENER_PROMPT = ChatPromptTemplate.from_messages([
    (
        "system",
        "You are an expert HR Screening Agent. Your job is to evaluate candidate "
        "resumes against a job description and produce a shortlist.\n\n"
        "RULES:\n"
        "1. Evaluate each candidate chunk for relevance to the job description.\n"
        "2. Assign a match_score from 0 to 100.\n"
        "3. Extract the candidate's name and email if visible.\n"
        "4. List the skills that match the required skills.\n"
        "5. Only shortlist candidates with match_score >= 40.\n"
        "6. Return ONLY valid JSON — an array of objects.\n\n"
        "Output format (JSON array):\n"
        "[\n"
        "  {{\n"
        '    "name": "Candidate Name",\n'
        '    "email": "candidate@email.com",\n'
        '    "match_score": 85,\n'
        '    "matched_skills": "Python, Django, REST APIs",\n'
        '    "source_file": "resume.pdf"\n'
        "  }}\n"
        "]\n\n"
        "If no candidates are suitable, return an empty array: []",
    ),
    (
        "human",
        "## Job Details\n"
        "**Title:** {job_title}\n"
        "**Description:** {job_description}\n"
        "**Required Skills:** {required_skills}\n"
        "**Minimum Experience:** {experience_years} years\n\n"
        "## Resume Data Retrieved from Vector DB\n"
        "{resume_chunks}\n\n"
        "Analyze the above resumes and return the shortlisted candidates as a JSON array.",
    ),
])


SCHEDULER_PROMPT = ChatPromptTemplate.from_messages([
    (
        "system",
        "You are an Interview Scheduling Coordinator. Given a list of shortlisted "
        "candidates, assign each one a unique interview time slot.\n\n"
        "RULES:\n"
        "1. Schedule interviews on upcoming weekdays starting from tomorrow.\n"
        "2. Time slots should be between 09:00 and 17:00, each 45 minutes apart.\n"
        "3. Return ONLY valid JSON — an array of objects.\n\n"
        "Output format (JSON array):\n"
        "[\n"
        "  {{\n"
        '    "name": "Candidate Name",\n'
        '    "email": "candidate@email.com",\n'
        '    "interview_slot": "Monday, June 2, 2025 at 10:00 AM"\n'
        "  }}\n"
        "]\n",
    ),
    (
        "human",
        "Shortlisted candidates:\n{candidates_json}\n\n"
        "Assign interview time slots and return the JSON array.",
    ),
])


COMMUNICATOR_PROMPT = ChatPromptTemplate.from_messages([
    (
        "system",
        "You are a Professional HR Communications Agent. Your job is to draft "
        "personalized interview invitation emails for shortlisted candidates.\n\n"
        "RULES:\n"
        "1. Be warm, professional, and concise.\n"
        "2. Include the interview date/time slot in the email body.\n"
        "3. Mention the job title and congratulate them on being shortlisted.\n"
        "4. Include a line asking them to confirm attendance.\n"
        "5. Return ONLY valid JSON — an array of objects.\n\n"
        "Output format (JSON array):\n"
        "[\n"
        "  {{\n"
        '    "name": "Candidate Name",\n'
        '    "email": "candidate@email.com",\n'
        '    "subject": "Interview Invitation — Job Title",\n'
        '    "body": "Full email body text here..."\n'
        "  }}\n"
        "]\n",
    ),
    (
        "human",
        "Job Title: {job_title}\n"
        "Company: Our Company\n\n"
        "Candidates with interview slots:\n{scheduled_json}\n\n"
        "Draft personalized emails for each candidate and return the JSON array.",
    ),
])


ATTENDANCE_PROMPT = ChatPromptTemplate.from_messages([
    (
        "system",
        "You are an expert HR Analyst Agent. Your job is to review employee attendance data "
        "(total work hours and number of leaves taken) and evaluate their performance/reliability.\n\n"
        "RULES:\n"
        "1. Analyze each employee's data.\n"
        "2. Assign an 'ai_score' out of 100 based on their reliability (high hours and low leaves mean a higher score).\n"
        "3. Write a concise, 1-sentence 'ai_feedback' performance review for each employee.\n"
        "4. Return ONLY valid JSON — an array of objects.\n\n"
        "Output format (JSON array):\n"
        "[\n"
        "  {{\n"
        '    "name": "Employee Name",\n'
        '    "total_hours": 160.5,\n'
        '    "leaves_taken": 2,\n'
        '    "ai_score": 85,\n'
        '    "ai_feedback": "Consistent attendance with acceptable leave balance, demonstrating strong reliability."\n'
        "  }}\n"
        "]\n",
    ),
    (
        "human",
        "Here is the raw attendance summary data:\n{attendance_data}\n\n"
        "Generate the performance report and return the JSON array.",
    ),
])
