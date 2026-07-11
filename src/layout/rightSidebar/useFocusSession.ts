import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "../../filesystem/tauriCommands";

interface UseFocusSessionOpts {
  wordCount: number;
  focusMode: boolean;
  setFocusMode: (v: boolean) => void;
  ydoc: any;
  currentDocumentId: string | null;
}

async function persistFocusSession(
  documentId: string,
  wordsWritten: number,
  startedAt: string,
) {
  if (wordsWritten <= 0) return;
  try {
    await invoke("save_focus_session", {
      documentId,
      wordsWritten,
      startedAt,
    });
  } catch (e) {
    console.error("Failed to save focus session:", e);
  }
}

export function useFocusSession({ wordCount, focusMode, setFocusMode, ydoc, currentDocumentId }: UseFocusSessionOpts) {
  const [focusSessionWords, setFocusSessionWords] = useState(0);
  const focusStartWordCount = useRef<number | null>(null);
  const focusStartedAt = useRef<string | null>(null);
  const wordCountRef = useRef(wordCount);

  useEffect(() => { wordCountRef.current = wordCount; }, [wordCount]);

  const endFocus = useCallback(() => {
    if (focusStartWordCount.current !== null) {
      const written = Math.max(0, wordCountRef.current - focusStartWordCount.current);
      setFocusSessionWords(written);
      if (currentDocumentId && focusStartedAt.current) {
        persistFocusSession(currentDocumentId, written, focusStartedAt.current);
      }
    }
    focusStartWordCount.current = null;
    focusStartedAt.current = null;
  }, [currentDocumentId]);

  useEffect(() => {
    const handleToggle = () => {
      if (!ydoc) return;
      const nextVal = !(ydoc.getMap("meta").get("focus_mode") as boolean || false);
      if (nextVal) {
        focusStartWordCount.current = wordCountRef.current;
        focusStartedAt.current = new Date().toISOString();
        setFocusSessionWords(0);
      } else {
        endFocus();
      }
      setFocusMode(nextVal);
      ydoc.getMap("meta").set("focus_mode", nextVal);
    };
    window.addEventListener("toggle-focus-mode", handleToggle);
    return () => window.removeEventListener("toggle-focus-mode", handleToggle);
  }, [ydoc, setFocusMode, endFocus]);

  useEffect(() => {
    if (focusMode && focusStartWordCount.current !== null) {
      setFocusSessionWords(Math.max(0, wordCount - focusStartWordCount.current));
    }
  }, [wordCount, focusMode]);

  const toggleFocusMode = useCallback(() => {
    const nextVal = !focusMode;
    if (nextVal) {
      focusStartWordCount.current = wordCount;
      focusStartedAt.current = new Date().toISOString();
      setFocusSessionWords(0);
    } else {
      endFocus();
    }
    setFocusMode(nextVal);
    if (ydoc) ydoc.getMap("meta").set("focus_mode", nextVal);
  }, [focusMode, wordCount, setFocusMode, ydoc, endFocus]);

  return { focusSessionWords, toggleFocusMode };
}
