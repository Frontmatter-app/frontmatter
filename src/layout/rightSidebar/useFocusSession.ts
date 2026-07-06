import { useEffect, useRef, useState } from "react";

interface UseFocusSessionOpts {
  wordCount: number;
  focusMode: boolean;
  setFocusMode: (v: boolean) => void;
  ydoc: any;
}

export function useFocusSession({ wordCount, focusMode, setFocusMode, ydoc }: UseFocusSessionOpts) {
  const [focusSessionWords, setFocusSessionWords] = useState(0);
  const focusStartWordCount = useRef<number | null>(null);
  const wordCountRef = useRef(wordCount);

  useEffect(() => { wordCountRef.current = wordCount; }, [wordCount]);

  useEffect(() => {
    const handleToggle = () => {
      if (!ydoc) return;
      const nextVal = !(ydoc.getMap("meta").get("focus_mode") as boolean || false);
      if (nextVal) { focusStartWordCount.current = wordCountRef.current; setFocusSessionWords(0); }
      else {
        if (focusStartWordCount.current !== null) setFocusSessionWords(Math.max(0, wordCountRef.current - focusStartWordCount.current));
        focusStartWordCount.current = null;
      }
      setFocusMode(nextVal);
      ydoc.getMap("meta").set("focus_mode", nextVal);
    };
    window.addEventListener("toggle-focus-mode", handleToggle);
    return () => window.removeEventListener("toggle-focus-mode", handleToggle);
  }, [ydoc, setFocusMode]);

  useEffect(() => {
    if (focusMode && focusStartWordCount.current !== null) setFocusSessionWords(Math.max(0, wordCount - focusStartWordCount.current));
  }, [wordCount, focusMode]);

  const toggleFocusMode = () => {
    const nextVal = !focusMode;
    if (nextVal) { focusStartWordCount.current = wordCount; setFocusSessionWords(0); }
    else {
      if (focusStartWordCount.current !== null) setFocusSessionWords(Math.max(0, wordCount - focusStartWordCount.current));
      focusStartWordCount.current = null;
    }
    setFocusMode(nextVal);
    if (ydoc) ydoc.getMap("meta").set("focus_mode", nextVal);
  };

  return { focusSessionWords, toggleFocusMode };
}
