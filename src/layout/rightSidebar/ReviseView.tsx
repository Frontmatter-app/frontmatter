import React from "react";
import { Ban, Check, ChevronDown, EyeOff, Wand2 } from "lucide-react";
import { cn } from "../../lib/utils";
import type { LintCategory, LintIgnoreState, LintIssue, ReviewKind } from "../../review/lintTypes";
import { addUnique, getIssueLocationText } from "../../review/lintTypes";
import type { ReadabilityStats } from "../../review/readability";
import type { Annotation } from "../../yjs/annotations";
import type { Suggestion } from "../../yjs/suggestions";
import * as Y from "yjs";
import { ReplyInput, reviewActionClass, reviewPillClass, reviewCardClass, SuggestionCard } from "./reviewCards";

interface ReviseViewProps {
  lintIssues: LintIssue[];
  readabilityStats: ReadabilityStats;
  grammarError: string | null;
  suggestions: Suggestion[];
  annotations: Annotation[];
  reviewFilter: ReviewKind | "all";
  onSetReviewFilter: (f: ReviewKind | "all") => void;
  lintIgnoreState: LintIgnoreState;
  onUpdateLintIgnore: (updater: (current: LintIgnoreState) => LintIgnoreState) => void;
  onJumpToIssue: (issue: LintIssue) => void;
  onApplyFix: (issue: LintIssue, replacement: string) => void;
  onCardClick: (item: { start_pos: Y.RelativePosition; end_pos: Y.RelativePosition }) => void;
  onAcceptSuggestion: (sug: Suggestion) => void;
  onRejectSuggestion: (sug: Suggestion) => void;
  onResolveAnnotation: (id: string) => void;
  onAddSuggestionReply: (sugId: string, text: string) => void;
  onAddAnnotationReply: (annId: string, text: string) => void;
  activeSuggestionId: string | null;
  activeAnnotationId: string | null;
  activeLintIssueId: string | null;
  cardRefs: React.MutableRefObject<{ [key: string]: HTMLDivElement | null }>;
}

/** The readability palette, so a card and its highlight are obviously the same thing. */
const CATEGORY_STYLE: Record<LintCategory, { accent: string; label: string; text: string }> = {
  "very-hard": { accent: "border-rose-500/40", label: "Very hard", text: "text-rose-600 dark:text-rose-400" },
  hard: { accent: "border-amber-500/40", label: "Hard", text: "text-amber-600 dark:text-amber-400" },
  passive: { accent: "border-emerald-500/40", label: "Passive", text: "text-emerald-600 dark:text-emerald-400" },
  adverb: { accent: "border-blue-500/40", label: "Adverb", text: "text-blue-600 dark:text-blue-400" },
  complex: { accent: "border-purple-500/40", label: "Wordy", text: "text-purple-600 dark:text-purple-400" },
  inclusive: { accent: "border-teal-500/40", label: "Wording", text: "text-teal-600 dark:text-teal-400" },
  grammar: { accent: "border-rose-400/40", label: "Grammar", text: "text-rose-600 dark:text-rose-400" },
};

/** Trims a sentence-length excerpt down to something a card can hold. */
function excerpt(text: string, limit = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}

function ReadabilitySummary({ stats }: { stats: ReadabilityStats }) {
  if (stats.words === 0) return null;
  const overAdverbs = stats.adverbs > stats.adverbBudget;
  const overPassives = stats.passives > stats.passiveBudget;

  return (
    <div className="flex flex-col gap-1 rounded-md border border-black/5 dark:border-white/5 bg-[var(--editor-secondary-bg)] px-2.5 py-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Readability</span>
        <span className="text-[11px] font-semibold text-[var(--editor-text-color)]">Grade {stats.grade}</span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[var(--editor-text-color)] opacity-75">
        <span className={stats.veryHardSentences > 0 ? "text-rose-600 dark:text-rose-400 font-semibold" : undefined}>
          {stats.veryHardSentences} very hard
        </span>
        <span className={stats.hardSentences > 0 ? "text-amber-600 dark:text-amber-400 font-semibold" : undefined}>
          {stats.hardSentences} hard
        </span>
        <span className={overAdverbs ? "text-blue-600 dark:text-blue-400 font-semibold" : undefined}>
          {stats.adverbs} adverbs (aim {stats.adverbBudget})
        </span>
        <span className={overPassives ? "text-emerald-600 dark:text-emerald-400 font-semibold" : undefined}>
          {stats.passives} passive (aim {stats.passiveBudget})
        </span>
      </div>
    </div>
  );
}

export function ReviseView(props: ReviseViewProps) {
  const { lintIssues, readabilityStats, grammarError, suggestions, annotations, reviewFilter, onSetReviewFilter,
    onUpdateLintIgnore, onJumpToIssue, onApplyFix, onCardClick, onAcceptSuggestion, onRejectSuggestion,
    onResolveAnnotation, onAddSuggestionReply, onAddAnnotationReply,
    activeSuggestionId, activeAnnotationId, activeLintIssueId, cardRefs } = props;

  const matchesReviewFilter = (kind: ReviewKind) => reviewFilter === "all" || reviewFilter === kind;
  const visibleSuggestions = matchesReviewFilter("suggestion") ? suggestions : [];
  const visibleAnnotations = matchesReviewFilter("note") ? annotations : [];
  const visibleLintIssues = lintIssues.filter((issue) => matchesReviewFilter(issue.severity));
  const noteCount = annotations.length;
  const suggestionCount = suggestions.length;
  const lintCount = lintIssues.length;
  const reprCounter = lintCount + suggestionCount + noteCount;

  const countBySeverity = (severity: ReviewKind) =>
    lintIssues.filter((issue) => issue.severity === severity).length;

  const reviewFilterItems: { key: ReviewKind | "all"; label: string; count: number }[] = [
    { key: "all", label: "All", count: reprCounter },
    { key: "error", label: "Errors", count: countBySeverity("error") },
    { key: "warning", label: "Warnings", count: countBySeverity("warning") },
    { key: "suggestion", label: "Suggestions", count: suggestions.length + countBySeverity("suggestion") },
    { key: "note", label: "Notes", count: annotations.length },
  ];

  const ignoreLintOnce = (issue: LintIssue) =>
    onUpdateLintIgnore((c) => ({ ...c, ignoredItemIds: addUnique(c.ignoredItemIds, issue.id) }));
  const ignoreLintRule = (issue: LintIssue) =>
    onUpdateLintIgnore((c) => ({ ...c, ignoredRules: addUnique(c.ignoredRules, issue.rule) }));
  const resolveLintIssue = (issue: LintIssue) =>
    onUpdateLintIgnore((c) => ({ ...c, resolvedItemIds: addUnique(c.resolvedItemIds, issue.id) }));

  return (
    <div className="flex-1 overflow-y-auto pt-2 flex flex-col gap-3 pb-24">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-[10px] font-bold text-gray-400 tracking-wider text-right uppercase">Review</h4>
          <span className="text-[10px] text-gray-400 font-semibold">{lintCount} issues &middot; {suggestionCount} suggestions &middot; {noteCount} notes</span>
        </div>
        <ReadabilitySummary stats={readabilityStats} />
        {grammarError && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-amber-700 dark:text-amber-400">
            <span className="font-semibold">Grammar check unavailable.</span>{" "}
            Readability and wording still work. If the app was built before the grammar
            checker was added, rebuild it.
            <span className="mt-1 block font-mono opacity-70 break-all">{grammarError}</span>
          </div>
        )}
        <div className="relative">
          <select title="Filter review items" value={reviewFilter} onChange={(e) => onSetReviewFilter(e.target.value as ReviewKind | "all")}
            className="w-full appearance-none rounded-md border border-black/5 dark:border-white/5 bg-[var(--editor-secondary-bg)] px-2.5 py-1.5 pr-7 text-[11px] font-semibold text-[var(--editor-text-color)] outline-none cursor-pointer transition hover:bg-[var(--editor-bg-color)] hover:border-black/10 dark:hover:border-white/10 focus:bg-[var(--editor-bg-color)] focus:border-black/15 dark:focus:border-white/15">
            {reviewFilterItems.map((item) => <option key={item.key} value={item.key}>{item.label} ({item.count})</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        </div>
      </div>

      {reprCounter === 0 ? (
        <div className="text-xs text-gray-400 dark:text-gray-500 italic leading-relaxed text-right mt-4">Nothing to flag. Select text and right-click to add a note, or edit to suggest changes.</div>
      ) : visibleSuggestions.length + visibleAnnotations.length + visibleLintIssues.length === 0 ? (
        <div className="text-xs text-gray-400 dark:text-gray-500 italic leading-relaxed text-right mt-4">No review items match this filter.</div>
      ) : (
        <div className="flex flex-col gap-3">
          {visibleLintIssues.map((issue) => {
            const style = CATEGORY_STYLE[issue.category] ?? CATEGORY_STYLE.grammar;
            const isActive = issue.id === activeLintIssueId;
            return (
              <div
                key={issue.id}
                // Registered under the same map the notes and suggestions use,
                // so the caret landing on a highlight scrolls this card into
                // view like every other kind of review item.
                ref={(el) => { cardRefs.current[issue.id] = el; }}
                onClick={() => onJumpToIssue(issue)}
                className={reviewCardClass(isActive, style.accent)}
              >
                <div className="flex justify-between items-start gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={cn(reviewPillClass, style.text)}>{style.label}</span>
                    {/* The pill names the category; the rule adds detail only
                        when it says something the pill does not, which is the
                        case for the inclusive-language and grammar rules. */}
                    {issue.rule !== issue.category && (
                      <span className="text-[9px] text-gray-400 dark:text-gray-500 font-mono truncate">{issue.rule}</span>
                    )}
                  </div>
                  <span className="text-[9px] text-gray-400 dark:text-gray-500 flex-shrink-0">{getIssueLocationText(issue)}</span>
                </div>
                <div className="text-xs text-[var(--editor-text-color)] leading-relaxed">{issue.message}</div>
                {issue.description && issue.description !== issue.message && (
                  <div className="text-[11px] text-[var(--editor-text-color)] opacity-75 leading-relaxed">{issue.description}</div>
                )}
                {issue.match && (
                  <span className="text-[11px] text-[var(--editor-text-color)] opacity-70 italic border-l border-black/10 dark:border-white/10 pl-2">&ldquo;{excerpt(issue.match)}&rdquo;</span>
                )}
                {issue.replacements.filter(Boolean).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {issue.replacements.filter(Boolean).map((replacement) => (
                      <button
                        key={replacement}
                        title={`Replace with "${replacement}"`}
                        onClick={(e) => { e.stopPropagation(); onApplyFix(issue, replacement); }}
                        className={reviewActionClass}
                      >
                        <Wand2 className="w-3 h-3" /> {replacement}
                      </button>
                    ))}
                  </div>
                )}
                {issue.link && <div className="text-[10px] text-[var(--editor-text-color)] opacity-60 break-all">{issue.link}</div>}
                <div className="grid grid-cols-3 gap-1.5 mt-1">
                  <button title="Resolve" onClick={(e) => { e.stopPropagation(); resolveLintIssue(issue); }} className={reviewActionClass}><Check className="w-3 h-3" /> Resolve</button>
                  <button title="Hide once" onClick={(e) => { e.stopPropagation(); ignoreLintOnce(issue); }} className={reviewActionClass}><EyeOff className="w-3 h-3" /> Once</button>
                  <button title="Hide rule" onClick={(e) => { e.stopPropagation(); ignoreLintRule(issue); }} className={reviewActionClass}><Ban className="w-3 h-3" /> Rule</button>
                </div>
              </div>
            );
          })}
          {visibleSuggestions.map((sug) => (
            <SuggestionCard key={sug.id} suggestion={sug} active={sug.id === activeSuggestionId}
              cardRef={(el) => { cardRefs.current[sug.id] = el; }} onCardClick={onCardClick}
              onAcceptSuggestion={onAcceptSuggestion} onRejectSuggestion={onRejectSuggestion}
              onAddSuggestionReply={onAddSuggestionReply} />
          ))}
          {visibleAnnotations.map((ann) => (
            <div key={ann.id} ref={(el) => { cardRefs.current[ann.id] = el; }} onClick={() => onCardClick(ann)} className={reviewCardClass(ann.id === activeAnnotationId, "border-amber-500/35")}>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1.5">
                  <span className={cn(reviewPillClass, "text-amber-600 dark:text-amber-400")}>Note</span>
                  <span className="text-[9px] text-gray-400 dark:text-gray-500 font-medium">{ann.author_id}</span>
                </div>
                <span className="text-[9px] text-gray-400 dark:text-gray-500">{new Date(ann.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              {ann.selected_text && <span className="text-[11px] text-[var(--editor-text-color)] opacity-70 line-clamp-2 italic border-l border-black/10 dark:border-white/10 pl-2">&ldquo;{ann.selected_text}&rdquo;</span>}
              <p className="text-xs text-[var(--editor-text-color)] leading-relaxed">{ann.note}</p>
              {/* One button. "Reject" sat beside this one and called the very
                  same handler, so the two words promised a choice that did not
                  exist and left no record of which had been picked. A note is a
                  remark, not a proposal — resolving it is the only outcome
                  there is until annotations carry a status of their own. */}
              <div className="flex gap-2 mt-1">
                <button title="Resolve" onClick={(e) => { e.stopPropagation(); onResolveAnnotation(ann.id); }} className={reviewActionClass}><Check className="w-3 h-3" /> Resolve</button>
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
              <div onClick={(e) => e.stopPropagation()}><ReplyInput onSend={(text) => onAddAnnotationReply(ann.id, text)} /></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { SuggestionCard } from "./reviewCards";
