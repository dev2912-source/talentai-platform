import logging
from typing import Any

from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field

from app.ai.llm import as_runnable_llm, get_llm, profile_value

logger = logging.getLogger(__name__)


class PerformanceReviewResult(BaseModel):
    """Structured output expected from the LLM for a performance review."""

    performance_score: int = Field(
        description="Overall performance score from 0 to 100 based on all provided metrics."
    )
    kpi_achievement_percent: float = Field(
        description="Calculated KPI achievement percentage from 0.0 to 100.0."
    )
    strengths: list[str] = Field(
        description="List of the employee's key strengths identified from the data."
    )
    areas_for_improvement: list[str] = Field(
        description="List of specific areas where the employee can improve."
    )
    recommended_actions: list[str] = Field(
        description="List of actionable recommendations for the employee's growth."
    )


parser = PydanticOutputParser(pydantic_object=PerformanceReviewResult)

PERFORMANCE_PROMPT = ChatPromptTemplate.from_messages([
    (
        "system",
        "You are an Expert HR Analyst and Performance Reviewer.\n"
        "Your task is to generate a comprehensive, structured performance review based on the provided employee data.\n"
        "Be objective, professional, and base your analysis strictly on the provided data.\n\n"
        "{format_instructions}\n",
    ),
    (
        "human",
        "Employee Profile Data:\n"
        "Name: {employee_name}\n"
        "Department: {department}\n"
        "Attendance Score: {attendance_score}/100\n\n"
        "Employee Specific Performance Data:\n"
        "{row_data}\n",
    ),
])


def generate_performance_review(employee_profile: dict[str, Any] | Any, row_data: str) -> dict[str, Any]:
    """
    Invoke the LLM with PydanticOutputParser to generate a structured performance review.
    Returns a dictionary of extracted review fields formatted for database storage.
    """
    try:
        llm = get_llm(temperature=0.2)
        chain = PERFORMANCE_PROMPT | as_runnable_llm(llm, raw_content=True) | parser

        result: PerformanceReviewResult = chain.invoke({
            "employee_name": profile_value(employee_profile, "username", "Employee"),
            "department": profile_value(employee_profile, "department", "General"),
            "attendance_score": profile_value(employee_profile, "attendance_score", 100),
            "row_data": row_data,
            "format_instructions": parser.get_format_instructions(),
        })

        return {
            "performance_score": result.performance_score,
            "kpi_achievement_percent": result.kpi_achievement_percent,
            "strengths": "\n".join(f"- {s}" for s in result.strengths),
            "areas_for_improvement": "\n".join(f"- {a}" for a in result.areas_for_improvement),
            "recommended_actions": "\n".join(f"- {r}" for r in result.recommended_actions),
        }
    except Exception as exc:
        logger.exception("Failed to generate performance review via LLM.")
        raise RuntimeError(f"Performance Review Agent Error: {exc}") from exc
