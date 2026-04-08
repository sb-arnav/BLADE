import { useState, useCallback } from "react";
// invoke available for future backend API calls

/**
 * API Playground — test API endpoints directly from Blade.
 * Like Postman/Insomnia but AI-powered and built into your AI assistant.
 */

export interface APIRequest {
  id: string;
  name: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
  url: string;
  headers: Record<string, string>;
  body: string;
  bodyType: "json" | "form" | "text" | "none";
  auth: {
    type: "none" | "bearer" | "basic" | "api-key";
    token?: string;
    username?: string;
    password?: string;
    keyName?: string;
    keyValue?: string;
    keyLocation?: "header" | "query";
  };
  queryParams: Array<{ key: string; value: string; enabled: boolean }>;
}

export interface APIResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bodyType: "json" | "html" | "xml" | "text" | "binary";
  duration: number;
  size: number;
  timestamp: number;
}

export interface SavedRequest {
  id: string;
  request: APIRequest;
  lastResponse: APIResponse | null;
  collection: string;
  createdAt: number;
  updatedAt: number;
  usageCount: number;
}

export interface RequestCollection {
  id: string;
  name: string;
  icon: string;
  requests: string[];
  createdAt: number;
}

const STORAGE_KEY = "blade-api-playground";
const COLLECTIONS_KEY = "blade-api-collections";

function loadRequests(): SavedRequest[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}

function saveRequests(reqs: SavedRequest[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reqs));
}

function loadCollections(): RequestCollection[] {
  try {
    return JSON.parse(localStorage.getItem(COLLECTIONS_KEY) || "[]");
  } catch {
    return [{ id: "default", name: "Default", icon: "📁", requests: [], createdAt: Date.now() }];
  }
}

function saveCollections(cols: RequestCollection[]) {
  localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(cols));
}

function createEmptyRequest(): APIRequest {
  return {
    id: crypto.randomUUID(),
    name: "New Request",
    method: "GET",
    url: "",
    headers: { "Content-Type": "application/json" },
    body: "",
    bodyType: "json",
    auth: { type: "none" },
    queryParams: [],
  };
}

function buildUrl(url: string, params: Array<{ key: string; value: string; enabled: boolean }>): string {
  const enabled = params.filter((p) => p.enabled && p.key);
  if (enabled.length === 0) return url;
  const qs = enabled.map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join("&");
  return url.includes("?") ? `${url}&${qs}` : `${url}?${qs}`;
}

function buildHeaders(request: APIRequest): Record<string, string> {
  const headers = { ...request.headers };

  switch (request.auth.type) {
    case "bearer":
      if (request.auth.token) headers["Authorization"] = `Bearer ${request.auth.token}`;
      break;
    case "basic":
      if (request.auth.username) {
        const encoded = btoa(`${request.auth.username}:${request.auth.password || ""}`);
        headers["Authorization"] = `Basic ${encoded}`;
      }
      break;
    case "api-key":
      if (request.auth.keyName && request.auth.keyValue && request.auth.keyLocation === "header") {
        headers[request.auth.keyName] = request.auth.keyValue;
      }
      break;
  }

  return headers;
}

function detectBodyType(body: string): APIResponse["bodyType"] {
  const trimmed = body.trim();
  if (!trimmed) return "text";
  try { JSON.parse(trimmed); return "json"; } catch {}
  if (trimmed.startsWith("<!") || trimmed.startsWith("<html")) return "html";
  if (trimmed.startsWith("<?xml") || trimmed.startsWith("<")) return "xml";
  return "text";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function useAPIPlayground() {
  const [savedRequests, setSavedRequests] = useState<SavedRequest[]>(loadRequests);
  const [collections, setCollections] = useState<RequestCollection[]>(loadCollections);
  const [activeRequest, setActiveRequest] = useState<APIRequest>(createEmptyRequest);
  const [lastResponse, setLastResponse] = useState<APIResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendRequest = useCallback(async (request?: APIRequest) => {
    const req = request || activeRequest;
    if (!req.url.trim()) {
      setError("URL is required");
      return null;
    }

    setLoading(true);
    setError(null);
    const startTime = Date.now();

    try {
      const url = buildUrl(req.url, req.queryParams);
      const headers = buildHeaders(req);

      // Use fetch directly (Tauri allows it with CSP configured)
      const fetchOptions: RequestInit = {
        method: req.method,
        headers,
      };

      if (req.method !== "GET" && req.method !== "HEAD" && req.body.trim()) {
        fetchOptions.body = req.body;
      }

      const resp = await fetch(url, fetchOptions);
      const body = await resp.text();
      const duration = Date.now() - startTime;

      const responseHeaders: Record<string, string> = {};
      resp.headers.forEach((value, key) => { responseHeaders[key] = value; });

      const apiResponse: APIResponse = {
        status: resp.status,
        statusText: resp.statusText,
        headers: responseHeaders,
        body,
        bodyType: detectBodyType(body),
        duration,
        size: new TextEncoder().encode(body).length,
        timestamp: Date.now(),
      };

      setLastResponse(apiResponse);
      setLoading(false);
      return apiResponse;
    } catch (e) {
      const errMsg = typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
      setError(errMsg);
      setLoading(false);
      return null;
    }
  }, [activeRequest]);

  const saveRequest = useCallback((collection?: string) => {
    const saved: SavedRequest = {
      id: activeRequest.id,
      request: { ...activeRequest },
      lastResponse,
      collection: collection || "default",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usageCount: 0,
    };

    setSavedRequests((prev) => {
      const existing = prev.findIndex((r) => r.id === saved.id);
      const next = existing >= 0
        ? prev.map((r, i) => i === existing ? { ...saved, createdAt: r.createdAt, usageCount: r.usageCount } : r)
        : [...prev, saved];
      saveRequests(next);
      return next;
    });
  }, [activeRequest, lastResponse]);

  const loadSavedRequest = useCallback((id: string) => {
    const saved = savedRequests.find((r) => r.id === id);
    if (saved) {
      setActiveRequest(saved.request);
      setLastResponse(saved.lastResponse);
      // Increment usage
      setSavedRequests((prev) => {
        const next = prev.map((r) => r.id === id ? { ...r, usageCount: r.usageCount + 1 } : r);
        saveRequests(next);
        return next;
      });
    }
  }, [savedRequests]);

  const deleteSavedRequest = useCallback((id: string) => {
    setSavedRequests((prev) => {
      const next = prev.filter((r) => r.id !== id);
      saveRequests(next);
      return next;
    });
  }, []);

  const newRequest = useCallback(() => {
    setActiveRequest(createEmptyRequest());
    setLastResponse(null);
    setError(null);
  }, []);

  const duplicateRequest = useCallback(() => {
    setActiveRequest({ ...activeRequest, id: crypto.randomUUID(), name: `${activeRequest.name} (copy)` });
    setLastResponse(null);
  }, [activeRequest]);

  const addCollection = useCallback((name: string, icon = "📁") => {
    setCollections((prev) => {
      const next = [...prev, { id: crypto.randomUUID(), name, icon, requests: [], createdAt: Date.now() }];
      saveCollections(next);
      return next;
    });
  }, []);

  const generateCurlCommand = useCallback((): string => {
    const req = activeRequest;
    const parts = [`curl -X ${req.method}`];
    const headers = buildHeaders(req);
    for (const [key, value] of Object.entries(headers)) {
      parts.push(`-H '${key}: ${value}'`);
    }
    if (req.body.trim() && req.method !== "GET") {
      parts.push(`-d '${req.body.replace(/'/g, "\\'")}'`);
    }
    parts.push(`'${buildUrl(req.url, req.queryParams)}'`);
    return parts.join(" \\\n  ");
  }, [activeRequest]);

  const importFromCurl = useCallback((curl: string) => {
    // Basic curl parser
    const req = createEmptyRequest();
    const methodMatch = curl.match(/-X\s+(\w+)/);
    if (methodMatch) req.method = methodMatch[1] as APIRequest["method"];

    const urlMatch = curl.match(/'([^']+)'|"([^"]+)"|(\S+)$/m);
    if (urlMatch) req.url = urlMatch[1] || urlMatch[2] || urlMatch[3] || "";

    const headerMatches = curl.matchAll(/-H\s+'([^:]+):\s*([^']+)'/g);
    for (const match of headerMatches) {
      req.headers[match[1]] = match[2];
    }

    const bodyMatch = curl.match(/-d\s+'([^']+)'/);
    if (bodyMatch) {
      req.body = bodyMatch[1];
      req.bodyType = "json";
    }

    setActiveRequest(req);
    setLastResponse(null);
  }, []);

  return {
    activeRequest,
    setActiveRequest,
    lastResponse,
    loading,
    error,
    sendRequest,
    saveRequest,
    loadSavedRequest,
    deleteSavedRequest,
    newRequest,
    duplicateRequest,
    savedRequests,
    collections,
    addCollection,
    generateCurlCommand,
    importFromCurl,
    formatBytes,
  };
}
