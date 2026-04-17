import { useState, useCallback, useRef } from "react";

/**
 * Screen Recorder — record screen sessions for demos, tutorials, bug reports.
 * Uses MediaRecorder API to capture screen + optional mic audio.
 */

export interface Recording {
  id: string;
  title: string;
  duration: number;
  size: number;
  blobUrl: string;
  thumbnail: string | null;
  createdAt: number;
  tags: string[];
}

export interface RecorderState {
  status: "idle" | "recording" | "paused" | "processing";
  duration: number;
  startedAt: number | null;
}

export function useScreenRecorder() {
  const [state, setState] = useState<RecorderState>({ status: "idle", duration: 0, startedAt: null });
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startRecording = useCallback(async (withAudio = false) => {
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false,
      });

      let combinedStream = displayStream;

      if (withAudio) {
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const tracks = [...displayStream.getTracks(), ...audioStream.getTracks()];
          combinedStream = new MediaStream(tracks);
        } catch {
          // No mic access, continue without audio
        }
      }

      streamRef.current = combinedStream;
      chunksRef.current = [];

      const recorder = new MediaRecorder(combinedStream, {
        mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
          ? "video/webm;codecs=vp9"
          : "video/webm",
      });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "video/webm" });
        const blobUrl = URL.createObjectURL(blob);
        const duration = state.duration;

        const recording: Recording = {
          id: crypto.randomUUID(),
          title: `Recording ${new Date().toLocaleString()}`,
          duration,
          size: blob.size,
          blobUrl,
          thumbnail: null,
          createdAt: Date.now(),
          tags: [],
        };

        setRecordings((prev) => [...prev, recording]);
        setState({ status: "idle", duration: 0, startedAt: null });

        if (timerRef.current) clearInterval(timerRef.current);

        // Stop all tracks
        combinedStream.getTracks().forEach((t) => t.stop());
      };

      // Handle stream ending (user clicks "Stop sharing")
      displayStream.getVideoTracks()[0].addEventListener("ended", () => {
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop();
        }
      });

      recorder.start(1000); // collect data every second
      mediaRecorderRef.current = recorder;

      const startTime = Date.now();
      setState({ status: "recording", duration: 0, startedAt: startTime });

      timerRef.current = setInterval(() => {
        setState((prev) => ({ ...prev, duration: Math.floor((Date.now() - startTime) / 1000) }));
      }, 1000);
    } catch (e) {
      console.error("[Blade] Screen recording failed:", e);
    }
  }, [state.duration]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording" || mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.pause();
      setState((prev) => ({ ...prev, status: "paused" }));
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, []);

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
      const resumeTime = Date.now();
      const currentDuration = state.duration;
      setState((prev) => ({ ...prev, status: "recording" }));
      timerRef.current = setInterval(() => {
        setState((prev) => ({
          ...prev,
          duration: currentDuration + Math.floor((Date.now() - resumeTime) / 1000),
        }));
      }, 1000);
    }
  }, [state.duration]);

  const deleteRecording = useCallback((id: string) => {
    setRecordings((prev) => {
      const recording = prev.find((r) => r.id === id);
      if (recording) URL.revokeObjectURL(recording.blobUrl);
      return prev.filter((r) => r.id !== id);
    });
  }, []);

  const downloadRecording = useCallback((id: string) => {
    const recording = recordings.find((r) => r.id === id);
    if (!recording) return;
    const a = document.createElement("a");
    a.href = recording.blobUrl;
    a.download = `${recording.title.replace(/[^a-zA-Z0-9]/g, "-")}.webm`;
    a.click();
  }, [recordings]);

  const renameRecording = useCallback((id: string, title: string) => {
    setRecordings((prev) => prev.map((r) => r.id === id ? { ...r, title } : r));
  }, []);

  const formatDuration = useCallback((seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }, []);

  const formatSize = useCallback((bytes: number): string => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }, []);

  return {
    state,
    recordings,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    deleteRecording,
    downloadRecording,
    renameRecording,
    formatDuration,
    formatSize,
  };
}
