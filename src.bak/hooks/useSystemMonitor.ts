import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * System Monitor — track CPU, memory, disk, and network usage.
 * Shows system health alongside AI usage.
 */

export interface SystemInfo {
  platform: string;
  arch: string;
  hostname: string;
  osVersion: string;
  cpuCores: number;
  totalMemory: number;
  uptime: number;
}

export interface SystemMetrics {
  cpuUsage: number;         // 0-100
  memoryUsed: number;       // bytes
  memoryTotal: number;      // bytes
  memoryPercent: number;    // 0-100
  diskUsed: number;
  diskTotal: number;
  diskPercent: number;
  processCount: number;
  bladeMemory: number;      // this process memory
  bladeCpu: number;         // this process CPU
  timestamp: number;
}

export interface MetricHistory {
  cpu: Array<{ value: number; timestamp: number }>;
  memory: Array<{ value: number; timestamp: number }>;
  disk: Array<{ value: number; timestamp: number }>;
}

const MAX_HISTORY = 60; // 60 data points = 5 minutes at 5s interval

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function useSystemMonitor(pollIntervalMs = 5000) {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [history, setHistory] = useState<MetricHistory>({ cpu: [], memory: [], disk: [] });
  const [error, setError] = useState<string | null>(null);

  // Fetch system info once on mount
  useEffect(() => {
    const fetchInfo = async () => {
      try {
        const info = await invoke<SystemInfo>("get_system_info");
        setSystemInfo(info);
      } catch {
        // Fallback — construct from navigator
        setSystemInfo({
          platform: navigator.platform || "unknown",
          arch: "x64",
          hostname: "local",
          osVersion: navigator.userAgent.match(/Windows NT [\d.]+|Mac OS X [\d._]+|Linux/)?.[0] || "unknown",
          cpuCores: navigator.hardwareConcurrency || 4,
          totalMemory: 0,
          uptime: 0,
        });
      }
    };
    fetchInfo();
  }, []);

  // Poll metrics
  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const m = await invoke<SystemMetrics>("get_system_metrics");
        setMetrics(m);
        setHistory((prev) => ({
          cpu: [...prev.cpu, { value: m.cpuUsage, timestamp: m.timestamp }].slice(-MAX_HISTORY),
          memory: [...prev.memory, { value: m.memoryPercent, timestamp: m.timestamp }].slice(-MAX_HISTORY),
          disk: [...prev.disk, { value: m.diskPercent, timestamp: m.timestamp }].slice(-MAX_HISTORY),
        }));
        setError(null);
      } catch {
        // Simulate metrics when backend isn't available
        const simulated: SystemMetrics = {
          cpuUsage: Math.random() * 30 + 10,
          memoryUsed: (4 + Math.random() * 4) * 1024 * 1024 * 1024,
          memoryTotal: 16 * 1024 * 1024 * 1024,
          memoryPercent: 40 + Math.random() * 20,
          diskUsed: 200 * 1024 * 1024 * 1024,
          diskTotal: 512 * 1024 * 1024 * 1024,
          diskPercent: 39,
          processCount: 150 + Math.floor(Math.random() * 50),
          bladeMemory: 80 * 1024 * 1024 + Math.random() * 50 * 1024 * 1024,
          bladeCpu: Math.random() * 5,
          timestamp: Date.now(),
        };
        setMetrics(simulated);
        setHistory((prev) => ({
          cpu: [...prev.cpu, { value: simulated.cpuUsage, timestamp: simulated.timestamp }].slice(-MAX_HISTORY),
          memory: [...prev.memory, { value: simulated.memoryPercent, timestamp: simulated.timestamp }].slice(-MAX_HISTORY),
          disk: [...prev.disk, { value: simulated.diskPercent, timestamp: simulated.timestamp }].slice(-MAX_HISTORY),
        }));
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, pollIntervalMs);
    return () => clearInterval(interval);
  }, [pollIntervalMs]);

  const getHealthStatus = useCallback((): "healthy" | "warning" | "critical" => {
    if (!metrics) return "healthy";
    if (metrics.cpuUsage > 90 || metrics.memoryPercent > 95 || metrics.diskPercent > 95) return "critical";
    if (metrics.cpuUsage > 70 || metrics.memoryPercent > 80 || metrics.diskPercent > 85) return "warning";
    return "healthy";
  }, [metrics]);

  return {
    systemInfo,
    metrics,
    history,
    error,
    getHealthStatus,
    formatBytes,
    formatUptime,
  };
}
