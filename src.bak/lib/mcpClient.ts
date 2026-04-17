// src/lib/mcpClient.ts
// Direct JSON-RPC client to bypass or communicate directly with native MCP pipelines
// Built on the standard JSON-RPC 2.0 protocol utilized by Model Context Protocol

import { Logger } from "./logger";
import { CryptoUtil } from "./crypto";

export interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: any;
}

export interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export class McpClient {
  private pendingRequests = new Map<string | number, { resolve: (val: any) => void, reject: (err: any) => void }>();
  
  /**
   * Parses an incoming raw string message (likely from an SSE stream or stdio payload)
   * resolving any pending requests mapped by ID.
   */
  public handleIncomingMessage(rawMessage: string) {
    try {
      const payload = JSON.parse(rawMessage) as JSONRPCResponse;
      if (payload.jsonrpc !== "2.0") {
        Logger.warn("Received non 2.0 JSON-RPC payload");
        return;
      }

      if (payload.id !== undefined && this.pendingRequests.has(payload.id)) {
        const { resolve, reject } = this.pendingRequests.get(payload.id)!;
        this.pendingRequests.delete(payload.id);

        if (payload.error) {
          reject(new Error(`[MCP Error ${payload.error.code}]: ${payload.error.message}`));
        } else {
          resolve(payload.result);
        }
      } else {
        // Might be a server notification
        Logger.debug("MCP Notification/Unknown ID received", payload);
      }
    } catch (err) {
      Logger.error("Failed to parse MCP message", err);
    }
  }

  /**
   * Constructs a formatted standard JSON-RPC envelope.
   */
  public buildRequest(method: string, params?: any): { request: JSONRPCRequest, payloadId: string } {
    const payloadId = CryptoUtil.generateUUID();
    const request: JSONRPCRequest = {
      jsonrpc: "2.0",
      id: payloadId,
      method,
      params
    };
    return { request, payloadId };
  }

  /**
   * Registers the promise waiting mechanism for the request.
   */
  public registerPending(id: string | number): Promise<any> {
    return new Promise((resolve, reject) => {
      // Typically we'd implement a timeout timer here
      this.pendingRequests.set(id, { resolve, reject });
      
      // Basic 30s timeout
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`MCP Request ${id} timed out`));
        }
      }, 30000);
    });
  }
}
