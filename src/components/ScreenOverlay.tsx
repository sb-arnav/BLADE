import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface Selection {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export function ScreenOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const startRef = useRef({ x: 0, y: 0 });

  const close = useCallback(() => {
    getCurrentWindow().hide();
  }, []);

  const captureRegion = useCallback(async (sel: Selection) => {
    const x = Math.min(sel.startX, sel.endX);
    const y = Math.min(sel.startY, sel.endY);
    const w = Math.abs(sel.endX - sel.startX);
    const h = Math.abs(sel.endY - sel.startY);

    if (w < 10 || h < 10) {
      close();
      return;
    }

    try {
      const png = await invoke<string>("capture_screen_region", {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(w),
        height: Math.round(h),
      });

      // Send to main window for analysis
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const main = await WebviewWindow.getByLabel("main");
      if (main) {
        await main.emit("screenshot_captured", png);
        await main.show();
        await main.setFocus();
      }
    } catch {
      // Capture failed
    }

    close();
  }, [close]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [close]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    startRef.current = { x: e.clientX, y: e.clientY };
    setSelecting(true);
    setSelection({
      startX: e.clientX,
      startY: e.clientY,
      endX: e.clientX,
      endY: e.clientY,
    });
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!selecting) return;
      setSelection({
        startX: startRef.current.x,
        startY: startRef.current.y,
        endX: e.clientX,
        endY: e.clientY,
      });
    },
    [selecting]
  );

  const handleMouseUp = useCallback(() => {
    if (selection && selecting) {
      captureRegion(selection);
    }
    setSelecting(false);
  }, [selection, selecting, captureRegion]);

  // Draw selection rectangle
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // Dim overlay
    ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (selection) {
      const x = Math.min(selection.startX, selection.endX);
      const y = Math.min(selection.startY, selection.endY);
      const w = Math.abs(selection.endX - selection.startX);
      const h = Math.abs(selection.endY - selection.startY);

      // Clear selection area
      ctx.clearRect(x, y, w, h);

      // Border
      ctx.strokeStyle = "#6366f1";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);

      // Size label
      if (w > 50 && h > 20) {
        ctx.fillStyle = "rgba(99, 102, 241, 0.9)";
        ctx.fillRect(x, y - 24, 80, 20);
        ctx.fillStyle = "#fff";
        ctx.font = "12px monospace";
        ctx.fillText(`${Math.round(w)}×${Math.round(h)}`, x + 4, y - 8);
      }
    }
  }, [selection]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        cursor: "crosshair",
        userSelect: "none",
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      />
      {!selecting && !selection && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            color: "#e5e5e5",
            fontSize: 14,
            fontFamily: "system-ui",
            textAlign: "center",
            pointerEvents: "none",
          }}
        >
          <div style={{ opacity: 0.8 }}>Draw a rectangle to capture</div>
          <div style={{ opacity: 0.5, fontSize: 12, marginTop: 4 }}>
            Esc to cancel
          </div>
        </div>
      )}
    </div>
  );
}
