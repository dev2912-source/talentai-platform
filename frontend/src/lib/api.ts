export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
).replace(/\/+$/, "");

/** Typed HTTP error returned by FastAPI endpoints. */
export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

async function parseErrorDetail(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data?.detail === "string") {
      return data.detail;
    }
    if (Array.isArray(data?.detail)) {
      return data.detail
        .map((item: { msg?: string }) => item.msg || JSON.stringify(item))
        .join(", ");
    }
    if (typeof data?.message === "string") {
      return data.message;
    }
  } catch {
    // Non-JSON error body; fall back to HTTP status text.
  }
  return res.statusText || `Request failed with status ${res.status}`;
}

function buildUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_URL}${normalizedPath}`;
}

function buildHeaders(
  headersInit?: HeadersInit,
  token?: string | null,
  body?: BodyInit | null,
): Headers {
  const headers = new Headers(headersInit);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (body && !(body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
}

/** Perform an authenticated JSON/FormData request against the FastAPI backend. */
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const headers = buildHeaders(options.headers, token, options.body);
  const res = await fetch(buildUrl(path), {
    ...options,
    headers,
  });

  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorDetail(res));
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

/** Download a binary file (PDF or Excel) with Supabase Bearer authentication. */
export async function apiDownloadBlob(
  path: string,
  token?: string | null,
): Promise<Blob> {
  const headers = buildHeaders(undefined, token);
  const res = await fetch(buildUrl(path), {
    method: "GET",
    headers,
  });

  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorDetail(res));
  }

  return await res.blob();
}
