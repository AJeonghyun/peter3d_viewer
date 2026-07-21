const API_ROOT = '/api';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, options);
  if (!response.ok) {
    let message = `요청 실패 (${response.status})`;
    try {
      const data = await response.json() as { detail?: string };
      message = data.detail || message;
    } catch {
      // Keep the status-based fallback for non-JSON failures.
    }
    throw new ApiError(response.status, message);
  }
  return response.json() as Promise<T>;
}
