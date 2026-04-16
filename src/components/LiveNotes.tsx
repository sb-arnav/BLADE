/**
 * LIVE NOTES — Real-time transcript + action items during meetings.
 * Ported from Omi's LiveNotesView.
 *
 * When a meeting is detected (Zoom/Teams/Meet running), this panel shows:
 *   - Live transcript streaming as words are spoken
 *   - Extracted action items highlighted
 *   - Speaker detection (if available)
 *   - Meeting timer
 */

import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface TranscriptChunk {
  id: number;
  timestamp: number;
  text: string;
  source: string;
  actionItems: string[];
}

interface LiveNotesProps {
  onBack: () => void;
}

export function LiveNotes({ onBack }: LiveNotesProps) {
  const [chunks, setChunks] = useState<TranscriptChunk[]>([]);
  const [inMeeting, setInMeeting] = useState(false);
  const [meetingStart, setMeetingStart] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState("00:00");
  const [actionItems, setActionItems] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Listen for audio timeline events
  useEffect(() => {
    const cleanups: Array<() => void> = [];

    listen<{ id: number; timestamp: number; transcript: string; source: string; in_meeting: boolean }>(
      "audio_timeline_tick",
      (event) => {
        const { id, timestamp, transcript, source, in_meeting } = event.payload;
        if (!in_meeting) return;

        setInMeeting(true);
        if (!meetingStart) setMeetingStart(timestamp);

        setChunks((prev) => [
          ...prev,
          { id, timestamp, text: transcript, source, actionItems: [] },
        ]);

        // Auto-scroll
        setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }), 100);
      }
    ).then((unlisten) => cleanups.push(unlisten));

    listen<{ meeting_id: string }>("audio_meeting_started", () => {
      setInMeeting(true);
      setMeetingStart(Math.floor(Date.now() / 1000));
      setChunks([]);
      setActionItems([]);
    }).then((unlisten) => cleanups.push(unlisten));

    listen<{ meeting_id: string; summary: string; action_items: string[]; decisions: string[] }>(
      "audio_meeting_ended",
      (event) => {
        setInMeeting(false);
        if (event.payload.action_items) {
          setActionItems(event.payload.action_items);
        }
      }
    ).then((unlisten) => cleanups.push(unlisten));

    return () => cleanups.forEach((fn) => fn());
  }, [meetingStart]);

  // Meeting timer
  useEffect(() => {
    if (!inMeeting || !meetingStart) return;
    const interval = setInterval(() => {
      const secs = Math.floor(Date.now() / 1000) - meetingStart;
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      setElapsed(`${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [inMeeting, meetingStart]);

  // Load recent audio on mount (in case meeting is already in progress)
  useEffect(() => {
    invoke<boolean>("timeline_detect_meeting").then((active) => {
      if (active) {
        setInMeeting(true);
        setMeetingStart(Math.floor(Date.now() / 1000) - 60);
      }
    }).catch(() => null);
  }, []);

  return (
    <div className="flex flex-col h-full bg-[#0a0a0f] text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[rgba(255,255,255,0.08)]">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-[rgba(255,255,255,0.5)] hover:text-white transition-colors text-sm">
            ← Back
          </button>
          <h1 className="text-[15px] font-semibold tracking-[-0.01em]">Live Notes</h1>
        </div>
        <div className="flex items-center gap-3">
          {inMeeting ? (
            <div className="flex items-center gap-2">
              <span className="w-[6px] h-[6px] rounded-full bg-[#f87171] animate-pulse" />
              <span className="text-xs text-[#f87171] font-mono">{elapsed}</span>
              <span className="text-xs text-[rgba(255,255,255,0.4)]">Recording</span>
            </div>
          ) : (
            <span className="text-xs text-[rgba(255,255,255,0.3)]">No meeting detected</span>
          )}
        </div>
      </div>

      {/* Transcript */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
        {chunks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-[40px] mb-3 opacity-20">🎙️</div>
            <div className="text-sm text-[rgba(255,255,255,0.3)]">
              {inMeeting ? "Listening..." : "Start a meeting (Zoom, Teams, Meet) and BLADE will take notes automatically"}
            </div>
          </div>
        ) : (
          chunks.map((chunk) => {
            const time = new Date(chunk.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
            return (
              <div key={chunk.id} className="flex gap-2">
                <span className="text-[10px] text-[rgba(255,255,255,0.25)] font-mono w-[60px] flex-shrink-0 pt-[2px]">{time}</span>
                <p className="text-[13px] leading-[1.6] text-[rgba(255,255,255,0.8)]">{chunk.text}</p>
              </div>
            );
          })
        )}
      </div>

      {/* Action items panel */}
      {actionItems.length > 0 && (
        <div className="px-5 py-3 border-t border-[rgba(255,255,255,0.08)] bg-[rgba(129,140,248,0.05)]">
          <div className="text-[11px] font-semibold text-[#818cf8] mb-2">Action Items</div>
          <div className="space-y-1">
            {actionItems.map((item, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-[10px] text-[#818cf8] mt-[2px]">•</span>
                <span className="text-[12px] text-[rgba(255,255,255,0.7)]">{item}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
