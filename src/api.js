const BASE = "/api";

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

export async function getStatus() {
  return request("/status");
}

export async function register(code) {
  return request("/register", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export async function refreshAuth() {
  return request("/refresh", { method: "POST" });
}

export async function listDocs() {
  return request("/docs");
}

export async function splitNotes(documentId) {
  return request("/split-notes", {
    method: "POST",
    body: JSON.stringify({ documentId }),
  });
}
