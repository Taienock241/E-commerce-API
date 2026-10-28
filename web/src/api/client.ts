import type { ApiErrorBody } from "./types";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(status: number, body: ApiErrorBody["error"]) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}

let readToken: () => string | null = () => typeof window === "undefined" ? null : window.localStorage.getItem("ecommerce.token");
let handleUnauthorized: () => void = () => {};

export function configureApi(session: { readToken: () => string | null; onUnauthorized: () => void }) {
  readToken = session.readToken;
  handleUnauthorized = session.onUnauthorized;
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const token = readToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch (error) {
    throw error;
  }

  if (response.status === 204) return undefined as T;
  const body = (await response.json()) as T | ApiErrorBody;
  if (!response.ok) {
    const errorBody = body as ApiErrorBody;
    const error = new ApiError(response.status, errorBody.error ?? { code: "REQUEST_FAILED", message: "Request failed" });
    if (response.status === 401) handleUnauthorized();
    throw error;
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => apiRequest<T>(path),
  post: <T>(path: string, body?: unknown, headers?: HeadersInit) =>
    apiRequest<T>(path, { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers }),
  patch: <T>(path: string, body: unknown) => apiRequest<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: "DELETE" }),
};
