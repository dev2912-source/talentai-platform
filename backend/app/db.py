from functools import lru_cache

from supabase import Client, create_client

from app.config import get_settings


@lru_cache
def _create_supabase_client(url: str, service_role_key: str) -> Client:
    return create_client(url, service_role_key)


def get_supabase() -> Client:
    """Return a Supabase service-role client configured from Settings."""
    settings = get_settings()
    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to create a Supabase client."
        )
    return _create_supabase_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)
