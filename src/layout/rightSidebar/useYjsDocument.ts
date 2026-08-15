import { useEffect, useRef, useState } from "react";
import { registry } from "../../yjs/DocumentRegistry";
import type { Stage } from "../../types";
import { EMPTY_IGNORE_STATE, type LintIgnoreState } from "../../review/lintTypes";
import * as Y from "yjs";

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readLintIgnoreState(doc: Y.Doc): LintIgnoreState {
  const meta = doc.getMap("meta");
  return {
    ignoredItemIds: readStringArray(meta.get("ignored_lint_item_ids")),
    ignoredRules: readStringArray(meta.get("ignored_lint_rules")),
    resolvedItemIds: readStringArray(meta.get("resolved_lint_item_ids")),
  };
}

export function useYjsDocument(currentDocumentId: string | null) {
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null);
  const [stage, setStage] = useState<Stage>("write");
  const [docText, setDocText] = useState("");
  const [focusMode, setFocusMode] = useState(false);
  const [lintIgnoreState, setLintIgnoreState] = useState<LintIgnoreState>(EMPTY_IGNORE_STATE);

  useEffect(() => {
    if (!currentDocumentId) { setYdoc(null); setDocText(""); return; }
    let active = true;
    let acquiredDoc: Y.Doc | null = null;
    let metaObs: (() => void) | null = null;
    let textObs: (() => void) | null = null;
    let textTimer: ReturnType<typeof setTimeout> | null = null;

    registry.acquire(currentDocumentId).then((doc) => {
      if (!active) return;
      acquiredDoc = doc;
      setYdoc(doc);
      const ytext = doc.getText("markdown");
      setDocText(ytext.toString());
      setStage((doc.getMap("meta").get("stage") as Stage) || "write");
      setFocusMode((doc.getMap("meta").get("focus_mode") as boolean) || false);
      setLintIgnoreState(readLintIgnoreState(doc));

      metaObs = () => {
        setStage((doc.getMap("meta").get("stage") as Stage) || "write");
        setFocusMode((doc.getMap("meta").get("focus_mode") as boolean) || false);
        setLintIgnoreState(readLintIgnoreState(doc));
      };
      doc.getMap("meta").observe(metaObs);

      // Settled text, not every keystroke.
      //
      // The only thing reading this is the review analysis, and it used to
      // re-render the whole sidebar and re-parse the whole document once per
      // character. The delay matches the editor's, so both sides analyse the
      // same string and the second one to ask reuses the first one's result
      // instead of repeating the work.
      textObs = () => {
        if (textTimer) clearTimeout(textTimer);
        textTimer = setTimeout(() => setDocText(ytext.toString()), 150);
      };
      ytext.observe(textObs);
    });
    return () => {
      active = false;
      if (textTimer) clearTimeout(textTimer);
      if (acquiredDoc && metaObs) acquiredDoc.getMap("meta").unobserve(metaObs);
      if (acquiredDoc && textObs) acquiredDoc.getText("markdown").unobserve(textObs);
      registry.release(currentDocumentId);
    };
  }, [currentDocumentId]);

  const updateLintIgnoreState = (updater: (current: LintIgnoreState) => LintIgnoreState) => {
    if (!ydoc) return;
    const meta = ydoc.getMap("meta");
    const next = updater(readLintIgnoreState(ydoc));
    meta.set("ignored_lint_item_ids", next.ignoredItemIds);
    meta.set("ignored_lint_rules", next.ignoredRules);
    meta.set("resolved_lint_item_ids", next.resolvedItemIds);
    setLintIgnoreState(next);
    window.dispatchEvent(new CustomEvent("editor-refresh-lint"));
  };

  return { ydoc, stage, setStage, docText, focusMode, setFocusMode, lintIgnoreState, updateLintIgnoreState };
}
