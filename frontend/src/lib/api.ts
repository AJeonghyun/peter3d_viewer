const API_ROOT = '/api';

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
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}
