import logging
import re
from typing import Any

from langchain_core.prompts import ChatPromptTemplate
from supabase import Client

from app.ai.llm import as_runnable_llm, get_llm, profile_value

logger = logging.getLogger(__name__)

SUPPORT_AGENT_PROMPT = ChatPromptTemplate.from_messages([
    (
        "system",
        "You are an expert, helpful HR Support Agent for the company.\n"
        "Your job is to answer the employee's questions accurately based ONLY on the provided context.\n\n"
        "Employee Profile Data:\n"
        "Name: {employee_name}\n"
        "Department: {department}\n"
        "Salary: ${salary}\n"
        "Leave Balance: {leave_balance} days\n"
        "Attendance Score: {attendance_score}/100\n\n"
        "Company Policy & FAQ Context:\n"
        "{context_data}\n\n"
        "RULES:\n"
        "1. Be polite, professional, and clear.\n"
        "2. If the user asks about their personal info (e.g., salary, leaves), use the Employee Profile Data.\n"
        "3. If they ask about policies, use the Company Policy & FAQ Context.\n"
        "4. DO NOT hallucinate. If the answer is not in the context, say 'I do not have that information at this time.'\n",
    ),
    ("human", "{user_message}"),
])


def _extract_keywords(message: str) -> list[str]:
    """Extract distinct alphanumeric keywords longer than 3 characters."""
    tokens = re.findall(r"[a-z0-9_-]+", message.lower())
    return list(dict.fromkeys(tok for tok in tokens if len(tok) > 3))


def _search_table_by_keywords(
    supabase: Client,
    table_name: str,
    columns: tuple[str, str],
    keywords: list[str],
) -> list[dict[str, Any]]:
    """Query a Supabase table using case-insensitive `.ilike` clauses across columns."""
    if not keywords:
        res = supabase.table(table_name).select("*").execute()
        return getattr(res, "data", None) or []

    clauses = [f"{col}.ilike.%{kw}%" for kw in keywords for col in columns]
    res = supabase.table(table_name).select("*").or_(",".join(clauses)).execute()
    return getattr(res, "data", None) or []


def generate_support_response(
    message: str,
    user_profile: Any,
    supabase: Client,
) -> str:
    """
    Keyword-filtered Knowledge Base lookup + Employee Profile context Support Agent.
    """
    try:
        keywords = _extract_keywords(message)
        policies = _search_table_by_keywords(
            supabase, "company_policies", ("title", "content"), keywords
        )
        faqs = _search_table_by_keywords(
            supabase, "faqs", ("question", "answer"), keywords
        )

        context_parts: list[str] = []
        for policy in policies:
            context_parts.append(f"POLICY: {policy.get('title', '')}\n{policy.get('content', '')}")
        for faq in faqs:
            context_parts.append(f"FAQ: Q: {faq.get('question', '')}\nA: {faq.get('answer', '')}")

        context_data = "\n\n".join(context_parts)
        if not context_data:
            context_data = "No specific policy or FAQ matches found."

        llm = get_llm(temperature=0.3)
        chain = SUPPORT_AGENT_PROMPT | as_runnable_llm(llm)

        response = chain.invoke({
            "employee_name": profile_value(user_profile, "username", "Employee"),
            "department": profile_value(user_profile, "department", "General"),
            "salary": profile_value(user_profile, "salary", 0.0),
            "leave_balance": profile_value(user_profile, "leave_balance", 0),
            "attendance_score": profile_value(user_profile, "attendance_score", 100),
            "context_data": context_data,
            "user_message": message,
        })

        return str(getattr(response, "content", response))
    except Exception as exc:
        logger.exception("Error in support agent")
        raise RuntimeError("Support agent failed to generate a response.") from exc
