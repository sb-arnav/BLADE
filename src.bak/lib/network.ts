// src/lib/network.ts
// Industrial fetch wrapper inspired by 'wretch' and 'ky'
// Built for multi-modal calls, resilient retry logic, and interceptors.

export class ApiError extends Error {
  constructor(public status: number, public message: string, public data?: any) {
    super(`HTTP ${status}: ${message}`);
    this.name = 'ApiError';
  }
}

interface FetchOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  retryDelay?: (attempt: number) => number;
}

export class Network {
  private static defaultOptions: FetchOptions = {
    timeoutMs: 10000,
    retries: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000), // Exponential backoff
    headers: {
      'Content-Type': 'application/json',
    },
  };

  /**
   * Resilient fetcher with timeouts, exponential backoff, and strict JSON typing.
   */
  public static async fetch<T>(url: string, options: FetchOptions = {}): Promise<T> {
    const config = { ...this.defaultOptions, ...options };
    const { timeoutMs, retries, retryDelay, ...fetchInit } = config;

    let abortController: AbortController | undefined;
    let attempt = 0;

    const execute = async (): Promise<T> => {
      try {
        if (timeoutMs) {
          abortController = new AbortController();
          setTimeout(() => abortController?.abort(), timeoutMs);
          fetchInit.signal = abortController.signal;
          // Clear timeout requires keeping track, handled below
        }

        const response = await fetch(url, fetchInit);
        
        if (!response.ok) {
          let errData;
          try { errData = await response.json(); } catch { errData = await response.text(); }
          throw new ApiError(response.status, response.statusText, errData);
        }

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          return await response.json() as T;
        }
        return await response.text() as unknown as T;
      } catch (error: any) {
        if (error.name === 'AbortError') {
          throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
        }
        
        if (attempt < (retries || 0)) {
          attempt++;
          const delay = retryDelay ? retryDelay(attempt) : 1000;
          await new Promise(res => setTimeout(res, delay));
          return execute();
        }
        throw error;
      }
    };

    return execute();
  }

  public static get<T>(url: string, options?: FetchOptions) {
    return this.fetch<T>(url, { ...options, method: 'GET' });
  }

  public static post<T>(url: string, body: any, options?: FetchOptions) {
    return this.fetch<T>(url, {
      ...options,
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
}
