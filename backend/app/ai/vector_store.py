import io
import logging
import os
import re
from typing import Any

import requests

from app.config import get_settings

logger = logging.getLogger(__name__)

EMBEDDING_DIM = 768
EMBEDDING_MODEL = "jinaai/jina-embeddings-v2-base-en"
DEFAULT_SEPARATORS = ["\n\n", "\n", ". ", " ", ""]


def extract_text_from_pdf_bytes(content: bytes) -> str:
    """Extract all text from PDF bytes using PyPDF2."""
    try:
        from PyPDF2 import PdfReader

        reader = PdfReader(io.BytesIO(content))
        pages = [text for page in reader.pages if (text := page.extract_text())]
        return "\n".join(pages)
    except Exception as exc:
        logger.error("Failed to extract text from PDF bytes: %s", exc)
        return ""


def extract_text_from_docx_bytes(content: bytes) -> str:
    """Extract all text from DOCX bytes using python-docx."""
    try:
        from docx import Document

        doc = Document(io.BytesIO(content))
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        return "\n".join(paragraphs)
    except Exception as exc:
        logger.error("Failed to extract text from DOCX bytes: %s", exc)
        return ""


def extract_text_from_bytes(filename: str, content: bytes) -> str:
    """Route raw file bytes to the appropriate extractor based on file extension."""
    ext = os.path.splitext(filename)[1].lower()
    if ext == ".pdf":
        return extract_text_from_pdf_bytes(content)
    if ext in (".docx", ".doc"):
        return extract_text_from_docx_bytes(content)
    return content.decode("utf-8", errors="ignore")


def extract_text(file_path: str) -> str:
    """Read a file from disk and extract its text content."""
    try:
        with open(file_path, "rb") as fh:
            return extract_text_from_bytes(file_path, fh.read())
    except Exception as exc:
        logger.error("Cannot read file %s: %s", file_path, exc)
        return ""


def extract_email_from_text(text: str) -> str:
    """Return the first email address found in text, or empty string."""
    match = re.search(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+", text)
    return match.group(0) if match else ""


def extract_name_from_text(text: str) -> str:
    """Heuristically treat the first non-empty non-contact line as candidate name."""
    for line in text.split("\n"):
        stripped = line.strip()
        if stripped and len(stripped) < 80 and not stripped.startswith("http"):
            if "@" not in stripped and not re.match(r"^[\d\s\-\+\(\)]+$", stripped):
                return stripped
    return "Unknown Candidate"


def _split_piece(text: str, chunk_size: int, chunk_overlap: int, separators: list[str]) -> list[str]:
    """Split a single text block recursively until all segments fit within chunk_size."""
    if len(text) <= chunk_size:
        return [text] if text else []

    sep = ""
    sep_index = len(separators) - 1
    for idx, candidate in enumerate(separators):
        if candidate == "" or candidate in text:
            sep = candidate
            sep_index = idx
            break

    if sep == "":
        step = max(1, chunk_size - chunk_overlap)
        return [text[i : i + chunk_size] for i in range(0, len(text), step) if text[i : i + chunk_size]]

    raw_parts = text.split(sep)
    next_seps = separators[sep_index + 1 :]
    refined: list[str] = []
    for part in raw_parts:
        if not part:
            continue
        if len(part) <= chunk_size:
            refined.append(part)
        else:
            refined.extend(_split_piece(part, chunk_size, chunk_overlap, next_seps))

    return _merge_pieces(refined, sep, chunk_size, chunk_overlap)


def _merge_pieces(pieces: list[str], sep: str, chunk_size: int, chunk_overlap: int) -> list[str]:
    """Merge smaller segments using sep without exceeding chunk_size, keeping overlap."""
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0

    for piece in pieces:
        piece_len = len(piece)
        added_len = piece_len if not current else len(sep) + piece_len

        if current and current_len + added_len > chunk_size:
            joined = sep.join(current)
            chunks.append(joined)

            # Retain trailing pieces that fit within chunk_overlap and leave room for piece
            overlap_parts: list[str] = []
            overlap_len = 0
            for prev in reversed(current):
                candidate_len = len(prev) if not overlap_parts else overlap_len + len(sep) + len(prev)
                if candidate_len <= chunk_overlap and candidate_len + len(sep) + piece_len <= chunk_size:
                    overlap_parts.insert(0, prev)
                    overlap_len = candidate_len
                else:
                    break
            current = overlap_parts
            current_len = overlap_len

        current.append(piece)
        current_len = piece_len if len(current) == 1 else current_len + len(sep) + piece_len

    if current:
        chunks.append(sep.join(current))
    return chunks


def split_text(
    text: str,
    chunk_size: int = 800,
    chunk_overlap: int = 100,
    separators: list[str] | None = None,
) -> list[str]:
    """Pure-Python recursive text splitter avoiding langchain_text_splitters import issues."""
    cleaned = text.strip()
    if not cleaned:
        return []
    seps = separators if separators is not None else list(DEFAULT_SEPARATORS)
    if not seps or seps[-1] != "":
        seps = [*seps, ""]
    return _split_piece(cleaned, chunk_size, min(chunk_overlap, max(0, chunk_size - 1)), seps)


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Generate 768-dim embeddings via OpenRouter with zero-vector fallback."""
    if not texts:
        return []

    settings = get_settings()
    api_key = settings.OPENROUTER_API_KEY
    if not api_key:
        logger.warning("OPENROUTER_API_KEY not set; using zero embeddings fallback.")
        return [[0.0] * EMBEDDING_DIM for _ in texts]

    api_url = f"{settings.OPENROUTER_BASE_URL.rstrip('/')}/embeddings"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {"model": EMBEDDING_MODEL, "input": texts}

    response = None
    try:
        response = requests.post(api_url, headers=headers, json=payload, timeout=30)
        response.raise_for_status()
        data = response.json()
        return [item["embedding"] for item in data["data"]]
    except Exception as exc:
        logger.error(
            "OpenRouter Embeddings API failed: %s. Response: %s",
            exc,
            getattr(response, "text", "No response"),
        )
        return [[0.0] * EMBEDDING_DIM for _ in texts]


def ingest_resumes_to_pgvector(
    supabase: Any,
    job_id: str,
    files: list[dict[str, Any] | str],
) -> list[dict[str, Any]]:
    """Extract text, chunk, embed, and store resume chunks in Supabase resume_chunks."""
    results: list[dict[str, Any]] = []

    for item in files:
        if isinstance(item, str):
            filename = os.path.basename(item)
            storage_path = ""
            full_text = extract_text(item)
        else:
            filename = item.get("filename") or os.path.basename(item.get("path", "resume.txt"))
            storage_path = item.get("storage_path", "")
            raw_bytes = item.get("content")
            if raw_bytes is not None:
                full_text = extract_text_from_bytes(filename, raw_bytes)
            elif item.get("path"):
                full_text = extract_text(item["path"])
            else:
                full_text = ""

        if not full_text.strip():
            logger.warning("No text extracted from %s — skipping.", filename)
            continue

        email = extract_email_from_text(full_text)
        name = extract_name_from_text(full_text)
        chunks = split_text(full_text, chunk_size=800, chunk_overlap=100)
        if not chunks:
            continue

        embeddings = embed_texts(chunks)
        rows = [
            {
                "job_id": job_id,
                "source_file": filename,
                "candidate_name": name,
                "candidate_email": email,
                "chunk_index": idx,
                "content": chunk,
                "embedding": embedding,
            }
            for idx, (chunk, embedding) in enumerate(zip(chunks, embeddings))
        ]
        supabase.table("resume_chunks").insert(rows).execute()

        results.append({
            "filename": filename,
            "storage_path": storage_path,
            "full_text": full_text,
            "email": email,
            "name": name,
            "num_chunks": len(chunks),
        })
        logger.info(
            "Ingested %s into pgvector: %d chunks, email=%s, name=%s",
            filename,
            len(chunks),
            email or "(none)",
            name,
        )

    return results


def search_resumes_pgvector(
    supabase: Any,
    query: str,
    job_id: str,
    match_count: int = 30,
) -> list[dict[str, Any]]:
    """Query Supabase pgvector RPC match_resume_chunks for top matching chunks."""
    if not query.strip():
        return []

    query_embedding = embed_texts([query])[0]
    try:
        rpc_res = supabase.rpc(
            "match_resume_chunks",
            {
                "query_embedding": query_embedding,
                "match_job_id": job_id,
                "match_count": match_count,
            },
        ).execute()
        rows = getattr(rpc_res, "data", None) or []
    except Exception as exc:
        logger.error("Supabase pgvector RPC failed: %s", exc)
        return []

    return [
        {
            "document": row.get("content", ""),
            "metadata": {
                "source_file": row.get("source_file", "N/A"),
                "candidate_name": row.get("candidate_name", "N/A"),
                "candidate_email": row.get("candidate_email", "N/A"),
                "job_id": job_id,
            },
            "similarity": float(row.get("similarity", 0.0) or 0.0),
        }
        for row in rows
    ]
