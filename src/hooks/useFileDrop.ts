import { useState, useEffect, useCallback } from "react";

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".ts", ".tsx", ".js", ".jsx",
  ".py", ".rs", ".csv", ".toml", ".yaml", ".yml", ".html",
  ".css", ".scss", ".xml", ".sql", ".sh", ".bat", ".cfg",
  ".ini", ".log", ".env", ".gitignore",
]);

function getExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx >= 0 ? filename.slice(idx).toLowerCase() : "";
}

export function useFileDrop(
  onImageDrop: (base64: string) => void,
  onTextDrop: (text: string) => void,
) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.relatedTarget === null || !document.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      const file = files[0];

      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") {
            onImageDrop(reader.result);
          }
        };
        reader.readAsDataURL(file);
      } else if (TEXT_EXTENSIONS.has(getExtension(file.name))) {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") {
            onTextDrop(reader.result);
          }
        };
        reader.readAsText(file);
      }
    },
    [onImageDrop, onTextDrop],
  );

  useEffect(() => {
    document.addEventListener("dragenter", handleDragEnter);
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("dragleave", handleDragLeave);
    document.addEventListener("drop", handleDrop);

    return () => {
      document.removeEventListener("dragenter", handleDragEnter);
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("dragleave", handleDragLeave);
      document.removeEventListener("drop", handleDrop);
    };
  }, [handleDragEnter, handleDragOver, handleDragLeave, handleDrop]);

  return { isDragging };
}
