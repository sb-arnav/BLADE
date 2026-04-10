// src/lib/pluginEngine.ts
// Secure WebWorker-based plugin sandboxing system for Phase 2 extensions.

import { Logger } from "./logger";
import { CryptoUtil } from "./crypto";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  permissions: Array<"network" | "storage" | "mcp" | "dom">;
  entryPoint: string;
}

export type PluginMessage = {
  type: "init" | "execute" | "terminate";
  payload: any;
};

export class PluginEngine {
  private activeWorkers = new Map<string, Worker>();
  
  /**
   * Loads a plugin from raw JavaScript source by creating a sandboxed Object URL.
   * This isolates the plugin from the main thread DOM and sensitive Tauri APIs.
   */
  public async loadPlugin(manifest: PluginManifest, sourceCode: string): Promise<string> {
    try {
      const pluginId = await CryptoUtil.sha256(`${manifest.id}_${manifest.version}`);
      
      if (this.activeWorkers.has(pluginId)) {
        Logger.warn(`Plugin ${manifest.name} is already running.`);
        return pluginId;
      }
      
      // Inject the sandboxed capability API based on manifest permissions
      const capabilityBridge = this.compileCapabilityBridge(manifest.permissions);
      
      const runnableSource = `
        ${capabilityBridge}
        // Sandboxed Plugin Execution
        (function() {
          try {
            ${sourceCode}
          } catch(e) {
            postMessage({ type: 'error', payload: e.message });
          }
        })();
      `;
      
      const blob = new Blob([runnableSource], { type: "application/javascript" });
      const workerUrl = URL.createObjectURL(blob);
      const worker = new Worker(workerUrl);
      
      worker.onmessage = this.handleWorkerMessage.bind(this, pluginId);
      worker.onerror = (e) => Logger.error(`Plugin ${manifest.name} crashed:`, e);
      
      this.activeWorkers.set(pluginId, worker);
      Logger.info(`Successfully loaded sandboxed plugin: ${manifest.name}`);
      
      return pluginId;
    } catch(err) {
      Logger.error(`Failed to load plugin: ${manifest.id}`, err);
      throw err;
    }
  }

  /**
   * Safely posts a message to a running plugin worker.
   */
  public dispatchAction(pluginId: string, action: string, data: any) {
    const worker = this.activeWorkers.get(pluginId);
    if (!worker) throw new Error(`Plugin ${pluginId} is not running`);
    
    worker.postMessage({ type: "execute", payload: { action, data } });
  }

  /**
   * Terminate a misbehaving plugin immediately.
   */
  public terminatePlugin(pluginId: string) {
    const worker = this.activeWorkers.get(pluginId);
    if (worker) {
      worker.terminate();
      this.activeWorkers.delete(pluginId);
      Logger.info(`Terminated plugin: ${pluginId}`);
    }
  }

  private handleWorkerMessage(pluginId: string, event: MessageEvent) {
    const { type, payload } = event.data;
    if (type === "error") {
      Logger.error(`[Plugin ${pluginId} Error]`, payload);
    } else {
      Logger.debug(`[Plugin ${pluginId}] msg:`, payload);
      // Route capabilities requests back to main thread (e.g. storage requests)
    }
  }

  private compileCapabilityBridge(permissions: string[]): string {
    // Expose only authorized capabilities to the global scope of the worker
    const allowsNetwork = permissions.includes("network");
    return `
      const self = globalThis;
      // Shadowing sensitive APIs
      ${!allowsNetwork ? 'self.fetch = function() { throw new Error("Network access denied"); };' : ''}
      self.XMLHttpRequest = function() { throw new Error("XHR access denied"); };
    `;
  }
}
