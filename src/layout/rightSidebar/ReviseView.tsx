import React, { useState } from "react";
import { Ban, Check, ChevronDown, EyeOff, X } from "lucide-react";
import { cn } from "../../lib/utils";
import type { ValeAlert } from "../../types";
import type { LintIgnoreState, ReviewKind } from "../../review/reviewIssues";
import {
  addUnique, getLintAlertId, getLintReviewKind,
  getValeActionText, getValeLocationText,
} from "../../review/reviewIssues";
import type { Annotation } from "../../yjs/annotations";
import type { Suggestion } from "../../yjs/suggestions";
import * as Y from "yjs";

function ReplyInput({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (text.trim()) { onSend(text.trim()); setText(""); } }}
      className="mt-2 flex gap-1"
    >
      <input
        type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply..."
        className="flex-1 text-[11px] bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded px-2.5 py-1 outline-none text-[var(--editor-text-color)] placeholder-gray-400"
      />
      <button type="submit" title="Add reply"
        className="text-[11px] bg-blue-500 hover:bg-blue-600 text-white font-semibold px-2.5 py-1 rounded-md cursor-pointer transition-colors">
        Reply
      </button>
    </form>
  );
}

const reviewActionClass =
  "flex items-center justify-center gap-1 px-2 py-1 rounded-md border border-black/5 dark:border-white/5 bg-[var(--editor-bg-color)] text-[10px] font-semibold text-[var(--editor-text-color)] opacity-75 hover:opacity-100 hover:border-black/15 dark:hover:border-white/15 cursor-pointer transition";

const reviewPillClass = "text-[9px] font-bold uppercase tracking-wider text-[var(--editor-text-color)] opacity-70";

const reviewCardClass = (active = false, accent = "border-black/10 dark:border-white/10") =>
  cn(
    "p-3 rounded-lg border transition-colors flex flex-col gap-2.5 cursor-pointer bg-[var(--editor-secondary-bg)]",
    active
      ? cn("bg-[var(--editor-bg-color)] shadow-sm", accent)
      : cn(accent, "hover:bg-[var(--editor-bg-color)] hover:border-black/10 dark:hover:border-white/10"),
  );

interface ReviseViewProps {
  lintAlerts: ValeAlert[];
  suggestions: Suggestion[];
  annotations: Annotation[];
  reviewFilter: ReviewKind | "all";
  onSetReviewFilter: (f: ReviewKind | "all") => void;
  lintIgnoreState: LintIgnoreState;
  onUpdateLintIgnore: (updater: (current: LintIgnoreState) => LintIgnoreState) => void;
  onJumpToLint: (alert: ValeAlert) => void;
  onCardClick: (item: { start_pos: Y.RelativePosition; end_pos: Y.RelativePosition }) => void;
  onAcceptSuggestion: (sug: Suggestion) => void;
  onRejectSuggestion: (sug: Suggestion) => void;
  onResolveAnnotation: (id: string) => void;
  onAddSuggestionReply: (sugId: string, text: string) => void;
  onAddAnnotationReply: (annId: string, text: string) => void;
  activeSuggestionId: string | null;
  activeAnnotationId: string | null;
  cardRefs: React.MutableRefObject<{ [key: string]: HTMLDivElement | null }>;
}

export function ReviseView({
  lintAlerts, suggestions, annotations, reviewFilter, onSetReviewFilter,
  lintIgnoreState, onUpdateLintIgnore, onJumpToLint, onCardClick,
  onAcceptSuggestion, onRejectSuggestion, onResolveAnnotation,
  onAddSuggestionReply, onAddAnnotationReply,
  activeSuggestionId, activeAnnotationId, cardRefs,
}: ReviseViewProps) {
  const matchesReviewFilter = (kind: ReviewKind) => reviewFilter === "all" || reviewFilter === kind;

  const visibleSuggestions = matchesReviewFilter("suggestion") ? suggestions : [];
  const visibleAnnotations = matchesReviewFilter("note") ? annotations : [];
  const visibleLintAlerts = lintAlerts.filter((alert) => matchesReviewFilter(getLintReviewKind(alert)));
  const visibleReviewCount = visibleSuggestions.length + visibleAnnotations.length + visibleLintAlerts.length;

  const noteCount = annotations.length;
  const suggestionCount = suggestions.length;
  const lintCount = lintAlerts.length;
  const reprCounter = lintCount + suggestionCount + noteCount;

  const reviewFilterItems: { key: ReviewKind | "all"; label: string; count: number }[] = [
    { key: "all", label: "All", count: reprCounter },
    { key: "error", label: "Errors", count: lintAlerts.filter((a) => getLintReviewKind(a) === "error").length },
    { key: "warning", label: "Warnings", count: lintAlerts.filter((a) => getLintReviewKind(a) === "warning").length },
    { key: "suggestion", label: "Suggestions", count: suggestions.length + lintAlerts.filter((a) => getLintReviewKind(a) === "suggestion").length },
    { key: "note", label: "Notes", count: annotations.length },
  ];

  const ignoreLintOnce = (alert: ValeAlert) => {
    onUpdateLintIgnore((current) => ({ ...current, ignoredItemIds: addUnique(current.ignoredItemIds, getLintAlertId(alert)) }));
  };
  const ignoreLintRule = (alert: ValeAlert) => {
    onUpdateLintIgnore((current) => ({ ...current, ignoredRules: addUnique(current.ignoredRules, alert.rule) }));
  };
  const resolveLintAlert = (alert: ValeAlert) => {
    onUpdateLintIgnore((current) => ({ ...current, resolvedItemIds: addUnique(current.resolvedItemIds, getLintAlertId(alert)) }));
  };

  return (
    <div className="flex-1 overflow-y-auto pt-2 flex flex-col gap-3 pb-24">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-[10px] font-bold text-gray-400 tracking-wider text-right uppercase">Review</h4>
          <span className="text-[10px] text-gray-400 font-semibold">
            {lintCount} issues · {suggestionCount} suggestions · {noteCount} notes
          </span>
        </div>
        <div className="relative">
          <select
            title="Filter review items" value={reviewFilter}
            onChange={(e) => onSetReviewFilter(e.target.value as ReviewKind | "all")}
            className="w-full appearance-none rounded-md border border-black/5 dark:border-white/5 bg-[var(--editor-secondary-bg)] px-2.5 py-1.5 pr-7 text-[11px] font-semibold text-[var(--editor-text-color)] outline-none cursor-pointer transition hover:bg-[var(--editor-bg-color)] hover:border-black/10 dark:hover:border-white/10 focus:bg-[var(--editor-bg-color)] focus:border-black/15 dark:focus:border-white/15"
          >
            {reviewFilterItems.map((item) => (
              <option key={item.key} value={item.key}>{item.label} ({item.count})</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        </div>
      </div>

      {reprCounter === 0 ? (
        <div className="text-xs text-gray-400 dark:text-gray-500 italic leading-relaxed text-right mt-4">
          Select text and right-click to add a note, or edit the text directly to suggest changes.
        </div>
      ) : visibleReviewCount === 0 ? (
        <div className="text-xs text-gray-400 dark:text-gray-500 italic leading-relaxed text-right mt-4">
          No review items match this filter.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {visibleLintAlerts.map((alert) => {
            const kind = getLintReviewKind(alert);
            const actionText = getValeActionText(alert);
            const isError = kind === "error";
            const isWarning = kind === "warning";
            const accentClass = isError ? "border-rose-500/35" : isWarning ? "border-amber-500/35" : "border-blue-500/35";
            const labelClass = isError ? "text-rose-600 dark:text-rose-400" : isWarning ? "text-amber-600 dark:text-amber-400" : "text-blue-600 dark:text-blue-400";
            return (
              <div key={getLintAlertId(alert)} onClick={() => onJumpToLint(alert)} className={reviewCardClass(false, accentClass)}>
                <div className="flex justify-between items-start gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={cn(reviewPillClass, labelClass)}>{kind}</span>
                    <span className="text-[9px] text-gray-400 dark:text-gray-500 font-mono truncate">{alert.rule}</span>
                  </div>
                  <span className="text-[9px] text-gray-400 dark:text-gray-500 flex-shrink-0">{getValeLocationText(alert)}</span>
                </div>
                <div className="text-xs text-[var(--editor-text-color)] leading-relaxed">{alert.message}</div>
                {alert.description && alert.description !== alert.message && (
                  <div className="text-[11px] text-[var(--editor-text-color)] opacity-75 leading-relaxed">{alert.description}</div>
                )}
                {alert.match && (
                  <span className="text-[11px] text-[var(--editor-text-color)] opacity-70 line-clamp-2 italic border-l border-black/10 dark:border-white/10 pl-2">
                    &ldquo;{alert.match}&rdquo;
                  </span>
                )}
                {actionText && (
                  <div className="text-[11px] text-[var(--editor-text-color)] opacity-80 leading-relaxed">
                    <span className="font-semibold">Suggested fix:</span> {actionText}
                  </div>
                )}
                {alert.link && <div className="text-[10px] text-[var(--editor-text-color)] opacity-60 break-all">{alert.link}</div>}
                <div className="grid grid-cols-3 gap-1.5 mt-1">
                  <button title="Mark this lint item as resolved" onClick={(e) => { e.stopPropagation(); resolveLintAlert(alert); }} className={reviewActionClass}>
                    <Check className="w-3 h-3" /> Resolve
                  </button>
                  <button title="Hide only this lint item" onClick={(e) => { e.stopPropagation(); ignoreLintOnce(alert); }} className={reviewActionClass}>
                    <EyeOff className="w-3 h-3" /> Once
                  </button>
                  <button title="Hide all lint items from this rule" onClick={(e) => { e.stopPropagation(); ignoreLintRule(alert); }} className={reviewActionClass}>
                    <Ban className="w-3 h-3" /> Rule
                  </button>
                </div>
              </div>
            );
          })}

          {visibleSuggestions.map((sug) => (
            <SuggestionCard
              key={sug.id}
              suggestion={sug}
              active={sug.id === activeSuggestionId}
              cardRef={(el) => { cardRefs.current[sug.id] = el; }}
              onCardClick={onCardClick}
              onAcceptSuggestion={onAcceptSuggestion}
              onRejectSuggestion={onRejectSuggestion}
              onAddSuggestionReply={onAddSuggestionReply}
            />
          ))}

          {visibleAnnotations.map((ann) => (
            <div key={ann.id} ref={(el) => { cardRefs.current[ann.id] = el; }} onClick={() => onCardClick(ann)}
              className={reviewCardClass(ann.id === activeAnnotationId, "border-amber-500/35")}>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1.5">
                  <span className={cn(reviewPillClass, "text-amber-600 dark:text-amber-400")}>Note</span>
                  <span className="text-[9px] text-gray-400 dark:text-gray-500 font-medium">{ann.author_id}</span>
                </div>
                <span className="text-[9px] text-gray-400 dark:text-gray-500">
                  {new Date(ann.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              {ann.selected_text && (
                <span className="text-[11px] text-[var(--editor-text-color)] opacity-70 line-clamp-2 italic border-l border-black/10 dark:border-white/10 pl-2">
                  &ldquo;{ann.selected_text}&rdquo;
                </span>
              )}
              <p className="text-xs text-[var(--editor-text-color)] leading-relaxed">{ann.note}</p>
              <div className="flex gap-2 mt-1">
                <button title="Mark this note as resolved" onClick={(e) => { e.stopPropagation(); onResolveAnnotation(ann.id); }} className={reviewActionClass}>
                  <Check className="w-3 h-3" /> Resolve
                </button>
                <button title="Dismiss this note" onClick={(e) => { e.stopPropagation(); onResolveAnnotation(ann.id); }} className={reviewActionClass}>
                  <X className="w-3 h-3" /> Reject
                </button>
              </div>
              {ann.replies && ann.replies.length > 0 && (
                <div className="mt-2 pl-3 border-l-2 border-amber-500/20 dark:border-amber-500/10 flex flex-col gap-2">
                  {ann.replies.map((r) => (
                    <div key={r.id} className="text-[11px] leading-relaxed">
                      <span className="font-semibold text-[var(--editor-text-color)] opacity-95">{r.author_id}: </span>
                      <span className="text-[var(--editor-text-color)] opacity-75">{r.text}</span>
                      <span className="block text-[9px] text-gray-400 dark:text-gray-500 mt-0.5">{new Date(r.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    </div>
                  ))}
                </div>
              )}
              <div onClick={(e) => e.stopPropagation()}>
                <ReplyInput onSend={(text) => onAddAnnotationReply(ann.id, text)} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface SuggestionCardProps {
  key?: React.Key;
  suggestion: Suggestion;
  active?: boolean;
  cardRef?: (el: HTMLDivElement | null) => void;
  onCardClick: (item: { start_pos: Y.RelativePosition; end_pos: Y.RelativePosition }) => void;
  onAcceptSuggestion: (sug: Suggestion) => void;
  onRejectSuggestion: (sug: Suggestion) => void;
  onAddSuggestionReply: (sugId: string, text: string) => void;
}

export function SuggestionCard({
  suggestion: sug,
  active = false,
  cardRef,
  onCardClick,
  onAcceptSuggestion,
  onRejectSuggestion,
  onAddSuggestionReply,
}: SuggestionCardProps) {
  return (
    <div ref={cardRef} onClick={() => onCardClick(sug)}
      className={reviewCardClass(active, "border-blue-500/35")}>
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-1.5">
          <span className={cn(reviewPillClass, "text-blue-600 dark:text-blue-400")}>Suggestion</span>
          <span className="text-[9px] text-gray-400 dark:text-gray-500 font-medium">{sug.author_id}</span>
        </div>
        <span className="text-[9px] text-gray-400 dark:text-gray-500">
          {new Date(sug.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <div className="text-xs text-[var(--editor-text-color)] leading-relaxed">
        {sug.type === 'delete' ? (
          <span>Suggest deleting: <span className="line-through text-rose-600 dark:text-rose-400 font-mono text-[11px]">"{sug.text}"</span></span>
        ) : (
          <span>Suggest inserting: <span className="text-emerald-600 dark:text-emerald-400 font-mono text-[11px]">"{sug.text}"</span></span>
        )}
      </div>
      <div className="flex gap-2 mt-1">
        <button title="Accept this suggested change" onClick={(e) => { e.stopPropagation(); onAcceptSuggestion(sug); }} className={reviewActionClass}>
          <Check className="w-3 h-3" /> Accept
        </button>
        <button title="Reject this suggested change" onClick={(e) => { e.stopPropagation(); onRejectSuggestion(sug); }} className={reviewActionClass}>
          <X className="w-3 h-3" /> Reject
        </button>
      </div>
      {sug.replies && sug.replies.length > 0 && (
        <div className="mt-2 pl-3 border-l-2 border-blue-500/20 dark:border-blue-500/10 flex flex-col gap-2">
          {sug.replies.map((r) => (
            <div key={r.id} className="text-[11px] leading-relaxed">
              <span className="font-semibold text-[var(--editor-text-color)] opacity-95">{r.author_id}: </span>
              <span className="text-[var(--editor-text-color)] opacity-75">{r.text}</span>
              <span className="block text-[9px] text-gray-400 dark:text-gray-500 mt-0.5">{new Date(r.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
            </div>
          ))}
        </div>
      )}
      <div onClick={(e) => e.stopPropagation()}>
        <ReplyInput onSend={(text) => onAddSuggestionReply(sug.id, text)} />
      </div>
    </div>
  );
}
