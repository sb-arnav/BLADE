// src/features/identity/SidecarView.tsx — Phase 6 Plan 06-06 (IDEN-07).
//
// Sidecar device control + Kali pentest utilities (D-158 — lifecycle +
// pentest commands Dialog-gated, pentest warning banner required).
//
// Structure:
//   1. Header — title + Start sidecar server (Dialog-confirmed).
//   2. Register device form — name + address + secret → sidecar_register_device.
//   3. Run-on-all banner — multi-device fan-out with Dialog confirm.
//   4. Devices table — list + per-row Ping / Run / Remove.
//   5. Kali Pentest utilities (collapsed by default) — 6 tool cards.
//
// Contract:
//   - No raw invoke (D-13).
//   - All invokes via @/lib/tauri/identity.
//   - sidecar_start_server, sidecar_run_all, sidecar_remove_device Dialog-confirmed
//     (T-06-06-01, T-06-06-04).
//   - Kali section collapsed by default; warning banner mandatory above cards
//     (T-06-06-02).
//   - data-testid surface: sidecar-view-root, sidecar-device-row,
//     kali-section-root, kali-tool-card.
//
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-158
// @see .planning/phases/06-life-os-identity/06-06-PLAN.md Task 2
// @see .planning/REQUIREMENTS.md §IDEN-07

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Dialog,
  EmptyState,
  GlassPanel,
  GlassSpinner,
  Input,
  Pill,
} from '@/design-system/primitives';
import { useToast } from '@/lib/context/ToastContext';
import {
  kaliAnalyzeCtf,
  kaliCheckTools,
  kaliCrackHash,
  kaliExplainExploit,
  kaliGeneratePayload,
  kaliRecon,
  sidecarListDevices,
  sidecarPingDevice,
  sidecarRegisterDevice,
  sidecarRemoveDevice,
  sidecarRunAll,
  sidecarRunCommand,
  sidecarStartServer,
} from '@/lib/tauri/identity';
import type {
  KaliScanResult,
  SidecarDevice,
  SidecarRunAllEntry,
} from './types';
import './identity.css';
import './identity-rich-b.css';

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function normalizeStatus(raw: string | undefined): 'online' | 'offline' | 'unreachable' | 'unknown' {
  if (typeof raw !== 'string') return 'unknown';
  const s = raw.toLowerCase();
  if (s === 'online') return 'online';
  if (s === 'offline') return 'offline';
  if (s === 'unreachable') return 'unreachable';
  return 'unknown';
}

function formatSeenAgo(lastSeen: number | null | undefined): string {
  if (typeof lastSeen !== 'number' || lastSeen <= 0) return '—';
  // last_seen is assumed in seconds-since-epoch (mirror Rust convention)
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - lastSeen));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// ═══════════════════════════════════════════════════════════════════════════
// KaliToolCard — input + run + inline output
// ═══════════════════════════════════════════════════════════════════════════

interface KaliToolCardProps {
  name: string;
  title: string;
  description: string;
  children: React.ReactNode;
  busy: boolean;
  onRun: () => void;
  canRun: boolean;
  runLabel?: string;
  output: string;
}

function KaliToolCard({
  name,
  title,
  description,
  children,
  busy,
  onRun,
  canRun,
  runLabel = 'Run',
  output,
}: KaliToolCardProps) {
  return (
    <div className="kali-tool-card" data-testid="kali-tool-card" data-tool={name}>
      <div className="kali-tool-title">{title}</div>
      <p className="kali-tool-desc">{description}</p>
      <div className="kali-tool-inputs">{children}</div>
      <div className="kali-tool-actions">
        {busy ? <GlassSpinner size={14} label={`Running ${title}`} /> : null}
        <Button variant="primary" size="sm" onClick={onRun} disabled={busy || !canRun}>
          {busy ? 'Running…' : runLabel}
        </Button>
      </div>
      <pre className="kali-tool-output" data-empty={output.length === 0 ? 'true' : 'false'}>
        {output.length > 0 ? output : '(no output yet — run the tool above)'}
      </pre>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// KaliSection — 6 tool cards, collapsed by default
// ═══════════════════════════════════════════════════════════════════════════

function KaliSection() {
  const { show } = useToast();
  const [open, setOpen] = useState<boolean>(false);

  // Recon.
  const [reconTarget, setReconTarget] = useState<string>('');
  const [reconBusy, setReconBusy] = useState<boolean>(false);
  const [reconOut, setReconOut] = useState<string>('');

  // Crack hash.
  const [hash, setHash] = useState<string>('');
  const [hashType, setHashType] = useState<string>('auto');
  const [hashBusy, setHashBusy] = useState<boolean>(false);
  const [hashOut, setHashOut] = useState<string>('');

  // Analyze CTF.
  const [ctfName, setCtfName] = useState<string>('');
  const [ctfCategory, setCtfCategory] = useState<string>('web');
  const [ctfDescription, setCtfDescription] = useState<string>('');
  const [ctfBusy, setCtfBusy] = useState<boolean>(false);
  const [ctfOut, setCtfOut] = useState<string>('');

  // Explain exploit.
  const [exploitCode, setExploitCode] = useState<string>('');
  const [exploitBusy, setExploitBusy] = useState<boolean>(false);
  const [exploitOut, setExploitOut] = useState<string>('');

  // Generate payload.
  const [payloadType, setPayloadType] = useState<string>('reverse-shell');
  const [payloadTarget, setPayloadTarget] = useState<string>('');
  const [payloadBusy, setPayloadBusy] = useState<boolean>(false);
  const [payloadOut, setPayloadOut] = useState<string>('');

  // Check tools.
  const [checkBusy, setCheckBusy] = useState<boolean>(false);
  const [checkOut, setCheckOut] = useState<string>('');

  const runRecon = useCallback(async () => {
    const t = reconTarget.trim();
    if (!t) return;
    setReconBusy(true);
    try {
      const result: KaliScanResult = await kaliRecon(t);
      const lines = [
        `target: ${result.target}`,
        `tool:   ${result.tool}`,
        `findings: ${Array.isArray(result.findings) ? result.findings.length : 0}`,
        '',
        result.output,
      ];
      setReconOut(lines.join('\n'));
    } catch (e) {
      show({ type: 'error', title: 'Recon failed', message: String(e) });
    } finally {
      setReconBusy(false);
    }
  }, [reconTarget, show]);

  const runCrackHash = useCallback(async () => {
    const h = hash.trim();
    if (!h) return;
    setHashBusy(true);
    try {
      const result = await kaliCrackHash({
        hash: h,
        hashType: hashType === 'auto' ? undefined : hashType,
      });
      setHashOut(String(result));
    } catch (e) {
      show({ type: 'error', title: 'Hash crack failed', message: String(e) });
    } finally {
      setHashBusy(false);
    }
  }, [hash, hashType, show]);

  const runCtf = useCallback(async () => {
    const name = ctfName.trim();
    const desc = ctfDescription.trim();
    if (!name || !desc) return;
    setCtfBusy(true);
    try {
      const result = await kaliAnalyzeCtf({
        name,
        category: ctfCategory,
        description: desc,
        files: [],
      });
      setCtfOut(String(result));
    } catch (e) {
      show({ type: 'error', title: 'CTF analysis failed', message: String(e) });
    } finally {
      setCtfBusy(false);
    }
  }, [ctfName, ctfCategory, ctfDescription, show]);

  const runExplain = useCallback(async () => {
    const code = exploitCode.trim();
    if (!code) return;
    setExploitBusy(true);
    try {
      const result = await kaliExplainExploit(code);
      setExploitOut(String(result));
    } catch (e) {
      show({ type: 'error', title: 'Explain exploit failed', message: String(e) });
    } finally {
      setExploitBusy(false);
    }
  }, [exploitCode, show]);

  const runPayload = useCallback(async () => {
    const target = payloadTarget.trim();
    if (!target) return;
    setPayloadBusy(true);
    try {
      const result = await kaliGeneratePayload({
        payloadType,
        targetInfo: target,
      });
      setPayloadOut(String(result));
    } catch (e) {
      show({ type: 'error', title: 'Payload generation failed', message: String(e) });
    } finally {
      setPayloadBusy(false);
    }
  }, [payloadType, payloadTarget, show]);

  const runCheck = useCallback(async () => {
    setCheckBusy(true);
    try {
      const result = await kaliCheckTools();
      // Render as a sorted key:value list (flat keys + nested _wordlists → pretty JSON).
      const lines: string[] = [];
      const entries = Object.entries(result).sort(([a], [b]) => a.localeCompare(b));
      for (const [k, v] of entries) {
        if (k === '_wordlists' && v && typeof v === 'object') {
          lines.push('_wordlists:');
          for (const [wk, wv] of Object.entries(v as Record<string, unknown>)) {
            lines.push(`  ${wk}: ${wv ? 'present' : 'missing'}`);
          }
        } else {
          lines.push(`${k}: ${v === true ? 'installed' : v === false ? 'missing' : JSON.stringify(v)}`);
        }
      }
      setCheckOut(lines.join('\n') || '(no tools reported)');
    } catch (e) {
      show({ type: 'error', title: 'Check tools failed', message: String(e) });
    } finally {
      setCheckBusy(false);
    }
  }, [show]);

  return (
    <section className="kali-section" data-testid="kali-section-root" data-open={open}>
      <div
        className="kali-section-header"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
      >
        <h3>Pentest Utilities (Kali)</h3>
        <span className="kali-section-toggle">{open ? '▾ hide' : '▸ show'}</span>
      </div>

      {open ? (
        <>
          <p className="kali-warning" role="note">
            These tools invoke network scanning + cryptographic operations. Use only on systems you are
            authorized to test.
          </p>
          <div className="kali-tools-grid">
            <KaliToolCard
              name="recon"
              title="Recon"
              description="Run initial reconnaissance against a target host or IP."
              busy={reconBusy}
              onRun={() => void runRecon()}
              canRun={reconTarget.trim().length > 0}
              output={reconOut}
            >
              <Input
                value={reconTarget}
                onChange={(e) => setReconTarget(e.target.value)}
                placeholder="target — e.g. 10.0.0.5 or example.com"
                aria-label="Recon target"
                mono
                disabled={reconBusy}
              />
            </KaliToolCard>

            <KaliToolCard
              name="crack-hash"
              title="Crack Hash"
              description="Attempt to crack a password hash. Leave hash type on auto to detect."
              busy={hashBusy}
              onRun={() => void runCrackHash()}
              canRun={hash.trim().length > 0}
              output={hashOut}
            >
              <Input
                value={hash}
                onChange={(e) => setHash(e.target.value)}
                placeholder="hash — paste the hash here"
                aria-label="Hash"
                mono
                disabled={hashBusy}
              />
              <select
                value={hashType}
                onChange={(e) => setHashType(e.target.value)}
                aria-label="Hash type"
                disabled={hashBusy}
              >
                <option value="auto">auto-detect</option>
                <option value="md5">md5</option>
                <option value="sha1">sha1</option>
                <option value="sha256">sha256</option>
                <option value="sha512">sha512</option>
                <option value="bcrypt">bcrypt</option>
                <option value="ntlm">ntlm</option>
              </select>
            </KaliToolCard>

            <KaliToolCard
              name="analyze-ctf"
              title="Analyze CTF"
              description="Get strategic analysis for a capture-the-flag challenge."
              busy={ctfBusy}
              onRun={() => void runCtf()}
              canRun={ctfName.trim().length > 0 && ctfDescription.trim().length > 0}
              output={ctfOut}
            >
              <Input
                value={ctfName}
                onChange={(e) => setCtfName(e.target.value)}
                placeholder="challenge name"
                aria-label="CTF challenge name"
                disabled={ctfBusy}
              />
              <select
                value={ctfCategory}
                onChange={(e) => setCtfCategory(e.target.value)}
                aria-label="CTF category"
                disabled={ctfBusy}
              >
                <option value="web">web</option>
                <option value="crypto">crypto</option>
                <option value="pwn">pwn</option>
                <option value="reverse">reverse</option>
                <option value="forensics">forensics</option>
                <option value="misc">misc</option>
              </select>
              <textarea
                value={ctfDescription}
                onChange={(e) => setCtfDescription(e.target.value)}
                placeholder="describe the challenge — prompt, clues, any given files"
                aria-label="CTF challenge description"
                disabled={ctfBusy}
              />
            </KaliToolCard>

            <KaliToolCard
              name="explain-exploit"
              title="Explain Exploit"
              description="Paste exploit code or a PoC snippet to get a walkthrough."
              busy={exploitBusy}
              onRun={() => void runExplain()}
              canRun={exploitCode.trim().length > 0}
              output={exploitOut}
            >
              <textarea
                value={exploitCode}
                onChange={(e) => setExploitCode(e.target.value)}
                placeholder="exploit code or PoC snippet"
                aria-label="Exploit code"
                disabled={exploitBusy}
              />
            </KaliToolCard>

            <KaliToolCard
              name="generate-payload"
              title="Generate Payload"
              description="Generate a payload for a given target platform."
              busy={payloadBusy}
              onRun={() => void runPayload()}
              canRun={payloadTarget.trim().length > 0}
              output={payloadOut}
            >
              <select
                value={payloadType}
                onChange={(e) => setPayloadType(e.target.value)}
                aria-label="Payload type"
                disabled={payloadBusy}
              >
                <option value="reverse-shell">reverse-shell</option>
                <option value="bind-shell">bind-shell</option>
                <option value="meterpreter">meterpreter</option>
                <option value="xss">xss</option>
                <option value="sqli">sqli</option>
              </select>
              <Input
                value={payloadTarget}
                onChange={(e) => setPayloadTarget(e.target.value)}
                placeholder="target info — e.g. linux/x64 lhost=10.0.0.2 lport=4444"
                aria-label="Payload target info"
                mono
                disabled={payloadBusy}
              />
            </KaliToolCard>

            <KaliToolCard
              name="check-tools"
              title="Check Tools"
              description="Scan for installed pentest tools + wordlists on this host."
              busy={checkBusy}
              onRun={() => void runCheck()}
              canRun
              runLabel="Scan tools"
              output={checkOut}
            >
              <p style={{ color: 'var(--t-3)', fontSize: 12, margin: 0 }}>No input — click scan.</p>
            </KaliToolCard>
          </div>
        </>
      ) : null}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SidecarView (root)
// ═══════════════════════════════════════════════════════════════════════════

export function SidecarView() {
  const { show } = useToast();

  const [devices, setDevices] = useState<SidecarDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState<boolean>(true);

  // Register form.
  const [rName, setRName] = useState<string>('');
  const [rAddress, setRAddress] = useState<string>('');
  const [rSecret, setRSecret] = useState<string>('');
  const [registerBusy, setRegisterBusy] = useState<boolean>(false);

  // Per-device inline command + output + busy (keyed by device id).
  const [commands, setCommands] = useState<Record<string, string>>({});
  const [outputs, setOutputs] = useState<Record<string, string>>({});
  const [runBusy, setRunBusy] = useState<Record<string, boolean>>({});
  const [pingBusy, setPingBusy] = useState<Record<string, boolean>>({});

  // Run on all.
  const [allCommand, setAllCommand] = useState<string>('');
  const [confirmRunAll, setConfirmRunAll] = useState<boolean>(false);
  const [runAllBusy, setRunAllBusy] = useState<boolean>(false);
  const [runAllResults, setRunAllResults] = useState<SidecarRunAllEntry[] | null>(null);

  // Start server.
  const [confirmStartServer, setConfirmStartServer] = useState<boolean>(false);
  const [startServerBusy, setStartServerBusy] = useState<boolean>(false);
  const [startServerPort, setStartServerPort] = useState<string>('8765');
  const [startServerSecret, setStartServerSecret] = useState<string>('');

  // Remove confirm.
  const [confirmRemove, setConfirmRemove] = useState<SidecarDevice | null>(null);
  const [removeBusy, setRemoveBusy] = useState<boolean>(false);

  const refreshDevices = useCallback(async () => {
    setDevicesLoading(true);
    try {
      const rows = await sidecarListDevices();
      setDevices(Array.isArray(rows) ? rows : []);
    } catch (e) {
      show({ type: 'error', title: 'Could not load devices', message: String(e) });
      setDevices([]);
    } finally {
      setDevicesLoading(false);
    }
  }, [show]);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  const doRegister = useCallback(async () => {
    const n = rName.trim();
    const a = rAddress.trim();
    const s = rSecret.trim();
    if (!n || !a || !s) {
      show({
        type: 'warn',
        title: 'Need all 3 fields',
        message: 'Name, address, and secret are required to register a device.',
      });
      return;
    }
    setRegisterBusy(true);
    try {
      await sidecarRegisterDevice({ name: n, address: a, secret: s });
      show({ type: 'success', title: 'Device registered', message: n });
      setRName('');
      setRAddress('');
      setRSecret('');
      await refreshDevices();
    } catch (e) {
      show({ type: 'error', title: 'Register failed', message: String(e) });
    } finally {
      setRegisterBusy(false);
    }
  }, [rName, rAddress, rSecret, refreshDevices, show]);

  const doPing = useCallback(
    async (device: SidecarDevice) => {
      setPingBusy((prev) => ({ ...prev, [device.id]: true }));
      try {
        const ping = await sidecarPingDevice(device.id);
        show({
          type: 'success',
          title: `Ping OK — ${device.name}`,
          message: `${ping.hostname} · ${ping.os} · v${ping.version}`,
        });
        await refreshDevices();
      } catch (e) {
        show({ type: 'error', title: `Ping failed — ${device.name}`, message: String(e) });
      } finally {
        setPingBusy((prev) => ({ ...prev, [device.id]: false }));
      }
    },
    [refreshDevices, show],
  );

  const doRun = useCallback(
    async (device: SidecarDevice) => {
      const cmd = (commands[device.id] ?? '').trim();
      if (!cmd) return;
      setRunBusy((prev) => ({ ...prev, [device.id]: true }));
      try {
        const result = await sidecarRunCommand({ deviceId: device.id, command: cmd });
        setOutputs((prev) => ({ ...prev, [device.id]: String(result) }));
      } catch (e) {
        setOutputs((prev) => ({ ...prev, [device.id]: `[error] ${String(e)}` }));
        show({ type: 'error', title: `Run failed — ${device.name}`, message: String(e) });
      } finally {
        setRunBusy((prev) => ({ ...prev, [device.id]: false }));
      }
    },
    [commands, show],
  );

  const doRunAll = useCallback(async () => {
    const cmd = allCommand.trim();
    if (!cmd) return;
    setRunAllBusy(true);
    try {
      const rows = await sidecarRunAll(cmd);
      setRunAllResults(Array.isArray(rows) ? rows : []);
      setConfirmRunAll(false);
      show({
        type: 'success',
        title: 'Fan-out complete',
        message: `Ran on ${Array.isArray(rows) ? rows.length : 0} device(s)`,
      });
    } catch (e) {
      show({ type: 'error', title: 'Run on all failed', message: String(e) });
    } finally {
      setRunAllBusy(false);
    }
  }, [allCommand, show]);

  const doStartServer = useCallback(async () => {
    const port = Number.parseInt(startServerPort, 10);
    const secret = startServerSecret.trim();
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      show({ type: 'warn', title: 'Bad port', message: 'Port must be 1-65535.' });
      return;
    }
    if (!secret) {
      show({ type: 'warn', title: 'Secret required', message: 'Enter a shared secret.' });
      return;
    }
    setStartServerBusy(true);
    try {
      const result = await sidecarStartServer({ port, secret });
      show({ type: 'success', title: 'Sidecar server started', message: String(result) });
      setConfirmStartServer(false);
    } catch (e) {
      show({ type: 'error', title: 'Start server failed', message: String(e) });
    } finally {
      setStartServerBusy(false);
    }
  }, [startServerPort, startServerSecret, show]);

  const doRemove = useCallback(async () => {
    if (!confirmRemove) return;
    setRemoveBusy(true);
    try {
      await sidecarRemoveDevice(confirmRemove.id);
      show({ type: 'success', title: 'Device removed', message: confirmRemove.name });
      setConfirmRemove(null);
      await refreshDevices();
    } catch (e) {
      show({ type: 'error', title: 'Remove failed', message: String(e) });
    } finally {
      setRemoveBusy(false);
    }
  }, [confirmRemove, refreshDevices, show]);

  const deviceRows = useMemo(() => devices, [devices]);

  return (
    <GlassPanel tier={1} className="identity-surface" data-testid="sidecar-view-root">
      <header className="sidecar-header">
        <div className="sidecar-header-title">
          <h2>Sidecar</h2>
          <span className="sidecar-header-subtitle">Remote device control + pentest utilities</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setConfirmStartServer(true)}
          disabled={startServerBusy}
        >
          Start sidecar server…
        </Button>
      </header>

      {/* ── Register device form ──────────────────────────────────── */}
      <form
        className="sidecar-register-form"
        onSubmit={(e) => {
          e.preventDefault();
          void doRegister();
        }}
        aria-label="Register a new sidecar device"
      >
        <label>
          <span>Name</span>
          <Input
            value={rName}
            onChange={(e) => setRName(e.target.value)}
            placeholder="lab-mac-mini"
            aria-label="Device name"
            disabled={registerBusy}
          />
        </label>
        <label>
          <span>Address (host:port)</span>
          <Input
            value={rAddress}
            onChange={(e) => setRAddress(e.target.value)}
            placeholder="192.168.1.42:8765"
            aria-label="Device address"
            mono
            disabled={registerBusy}
          />
        </label>
        <label style={{ gridColumn: '1 / -1' }}>
          <span>Secret (shared with the sidecar server)</span>
          <Input
            value={rSecret}
            onChange={(e) => setRSecret(e.target.value)}
            placeholder="shared secret"
            aria-label="Device secret"
            mono
            type="password"
            disabled={registerBusy}
          />
        </label>
        <div className="sidecar-register-actions" style={{ gridColumn: '1 / -1' }}>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            disabled={
              registerBusy ||
              rName.trim().length === 0 ||
              rAddress.trim().length === 0 ||
              rSecret.trim().length === 0
            }
          >
            {registerBusy ? 'Registering…' : 'Register device'}
          </Button>
        </div>
      </form>

      {/* ── Run on all banner ─────────────────────────────────────── */}
      <div className="sidecar-run-all-banner">
        <textarea
          value={allCommand}
          onChange={(e) => setAllCommand(e.target.value)}
          placeholder="Command to run on ALL registered devices — e.g. `uptime`"
          aria-label="Command to fan out"
          disabled={runAllBusy}
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setConfirmRunAll(true)}
          disabled={runAllBusy || allCommand.trim().length === 0 || deviceRows.length === 0}
        >
          Run on all…
        </Button>
      </div>

      {runAllResults ? (
        <div className="sidecar-run-all-results" aria-label="Run-on-all results">
          {runAllResults.length === 0 ? (
            <div className="sidecar-device-empty">No devices responded.</div>
          ) : (
            runAllResults.map((r, i) => (
              <div
                key={`${r.device ?? i}-${i}`}
                className="sidecar-run-all-row"
                data-error={r.error && r.error.length > 0 ? 'true' : 'false'}
              >
                <div className="sidecar-run-all-row-device">
                  {r.device ?? '(unknown device)'} {r.error && r.error.length > 0 ? `· error` : ''}
                </div>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                  {r.error && r.error.length > 0 ? r.error : (r.result ?? '(no output)')}
                </pre>
              </div>
            ))
          )}
        </div>
      ) : null}

      {/* ── Devices table ─────────────────────────────────────────── */}
      <div className="sidecar-device-table">
        {devicesLoading ? (
          <div className="sidecar-device-empty">
            <GlassSpinner size={18} label="Loading devices" />
          </div>
        ) : deviceRows.length === 0 ? (
          <EmptyState
            label="No sidecar data"
            description="The sidecar shows peripheral context from tools + memory."
          />
        ) : (
          deviceRows.map((device) => {
            const status = normalizeStatus(device.status);
            const isRunBusy = runBusy[device.id] === true;
            const isPingBusy = pingBusy[device.id] === true;
            const output = outputs[device.id];
            const command = commands[device.id] ?? '';
            return (
              <div
                key={device.id}
                className="sidecar-device-row"
                data-testid="sidecar-device-row"
                data-device-id={device.id}
                data-status={status}
              >
                <div className="sidecar-device-main">
                  <span className="sidecar-device-name">{device.name}</span>
                  <span className="sidecar-device-address">{device.address}</span>
                </div>
                <span className="sidecar-device-status">{status}</span>
                <span className="sidecar-device-seen">
                  {formatSeenAgo(device.last_seen ?? null)}
                </span>
                <div className="sidecar-device-actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void doPing(device)}
                    disabled={isPingBusy}
                  >
                    {isPingBusy ? 'Pinging…' : 'Ping'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmRemove(device)}
                    disabled={removeBusy}
                  >
                    Remove
                  </Button>
                </div>
                <div className="sidecar-device-row-expand">
                  <div className="sidecar-device-run-row">
                    <Input
                      value={command}
                      onChange={(e) =>
                        setCommands((prev) => ({ ...prev, [device.id]: e.target.value }))
                      }
                      placeholder={`Command to run on ${device.name} — Enter to execute`}
                      aria-label={`Command for ${device.name}`}
                      mono
                      disabled={isRunBusy}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void doRun(device);
                        }
                      }}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void doRun(device)}
                      disabled={isRunBusy || command.trim().length === 0}
                    >
                      {isRunBusy ? 'Running…' : 'Run'}
                    </Button>
                  </div>
                  {output && output.length > 0 ? (
                    <pre className="sidecar-device-output">{output}</pre>
                  ) : null}
                  {Array.isArray(device.capabilities) && device.capabilities.length > 0 ? (
                    <div style={{ display: 'flex', gap: 'var(--s-1)', flexWrap: 'wrap' }}>
                      {device.capabilities.map((cap) => (
                        <Pill key={cap} tone="default">
                          {cap}
                        </Pill>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Kali sub-section ──────────────────────────────────────── */}
      <KaliSection />

      {/* ── Dialogs ───────────────────────────────────────────────── */}

      <Dialog
        open={confirmStartServer}
        onClose={() => (startServerBusy ? undefined : setConfirmStartServer(false))}
        ariaLabel="Confirm start sidecar server"
      >
        <div className="kali-dialog-body">
          <h3>Start sidecar server?</h3>
          <p>
            Launches the local sidecar server so remote devices can connect to this machine. Configure
            the listen port and a shared secret that remote clients will use to authenticate.
          </p>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-1)', fontSize: 12 }}>
            <span>Port</span>
            <Input
              value={startServerPort}
              onChange={(e) => setStartServerPort(e.target.value)}
              placeholder="8765"
              aria-label="Server port"
              mono
              disabled={startServerBusy}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-1)', fontSize: 12 }}>
            <span>Shared secret</span>
            <Input
              value={startServerSecret}
              onChange={(e) => setStartServerSecret(e.target.value)}
              placeholder="shared secret"
              aria-label="Server shared secret"
              mono
              type="password"
              disabled={startServerBusy}
            />
          </label>
          <div className="kali-dialog-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmStartServer(false)}
              disabled={startServerBusy}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void doStartServer()}
              disabled={startServerBusy}
            >
              {startServerBusy ? 'Starting…' : 'Start server'}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={confirmRunAll}
        onClose={() => (runAllBusy ? undefined : setConfirmRunAll(false))}
        ariaLabel="Confirm run on all devices"
      >
        <div className="kali-dialog-body">
          <h3>Run this command on ALL devices?</h3>
          <p>
            <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--t-1)' }}>
              {allCommand.trim() || '(empty)'}
            </code>{' '}
            will run on all {deviceRows.length} registered device(s). Per-device output will be shown
            when the fan-out finishes.
          </p>
          <div className="kali-dialog-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmRunAll(false)}
              disabled={runAllBusy}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void doRunAll()}
              disabled={runAllBusy}
            >
              {runAllBusy ? 'Running on all…' : 'Run on all devices'}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={confirmRemove !== null}
        onClose={() => (removeBusy ? undefined : setConfirmRemove(null))}
        ariaLabel="Confirm remove device"
      >
        <div className="kali-dialog-body">
          <h3>Remove {confirmRemove?.name}?</h3>
          <p>
            Removes the device from the sidecar registry. The remote machine will no longer be reachable
            via sidecar commands. You can re-register it later.
          </p>
          <div className="kali-dialog-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmRemove(null)}
              disabled={removeBusy}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void doRemove()}
              disabled={removeBusy}
            >
              {removeBusy ? 'Removing…' : 'Remove device'}
            </Button>
          </div>
        </div>
      </Dialog>
    </GlassPanel>
  );
}
