/**
 * In Vite dev, use empty base so `/api` and `/static` hit the dev proxy.
 * For production build served behind the same host as the API, keep empty.
 * Override with `VITE_API_BASE` when the API is on another origin.
 */
export const apiBase = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

export function toAbsoluteUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return "";
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl;
  }
  return `${apiBase}${pathOrUrl}`;
}

export async function uploadDemo(): Promise<unknown> {
  const resp = await fetch(`${apiBase}/api/upload-demo`, { method: "POST" });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

export async function uploadFile(file: File): Promise<unknown> {
  const form = new FormData();
  form.append("file", file);
  const resp = await fetch(`${apiBase}/api/upload`, { method: "POST", body: form });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

export interface CreateTaskPayload {
  demoSampleId?: string;
}

export async function createTask(uploadId: string, payload: CreateTaskPayload = {}): Promise<unknown> {
  const body: { upload_id: string; n_samples: number; demo_sample_id?: string } = {
    upload_id: uploadId,
    n_samples: 1,
  };
  if (payload.demoSampleId) {
    body.demo_sample_id = payload.demoSampleId;
  }
  const resp = await fetch(`${apiBase}/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

export async function getTask(taskId: string): Promise<unknown> {
  const resp = await fetch(`${apiBase}/api/tasks/${taskId}`);
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

export async function getTaskResult(taskId: string): Promise<unknown> {
  const resp = await fetch(`${apiBase}/api/task/${taskId}/result`);
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}
