import React, { useState } from "react";
import { Check, X } from "lucide-react";
import { cn } from "../../lib/utils";
import type { Suggestion } from "../../yjs/suggestions";
import * as Y from "yjs";

export function ReplyInput({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) { onSend(text.trim()); setText(""); } }} className="mt-2 flex gap-1">
      <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply..."
        className="flex-1 text-[11px] bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded px-2.5 py-1 outline-none text-[var(--editor-text-color)] placeholder-gray-400" />
      <button type="submit" title="Add reply"
        className="text-[11px] bg-blue-500 hover:bg-blue-600 text-white font-semibold px-2.5 py-1 rounded-md cursor-pointer transition-colors">Reply</button>
    </form>
  );
}

export const reviewActionClass = "flex items-center justify-center gap-1 px-2 py-1 rounded-md border border-black/5 dark:border-white/5 bg-[var(--editor-bg-color)] text-[10px] font-semibold text-[var(--editor-text-color)] opacity-75 hover:opacity-100 hover:border-black/15 dark:hover:border-white/15 cursor-pointer transition";
export const reviewPillClass = "text-[9px] font-bold uppercase tracking-wider text-[var(--editor-text-color)] opacity-70";
/**
 * The card for one review item, lifted off the stack when it is the active one.
 *
 * Scrolling a card into view is not the same as saying which one it is: the
 * card the editor jumped to arrived in the middle of a column of cards that
 * looked exactly like it, distinguished by a background tint and a 1px shadow.
 *
 * So the active card is picked up off the page instead — tilted three degrees,
 * scaled a little, and given a shadow deep enough to read as height. The tilt
 * is the part that carries at a glance, because nothing else in the column is
 * off-square; the shadow and the scale say which direction it moved. Three
 * degrees is as far as it can go and stay legible: the column is narrow and
 * scrolls, so a steeper angle would push the corners past the edge and over
 * the cards either side.
 *
 * `relative z-10` puts it above its neighbours so the shadow falls on them
 * rather than under them, and the transition covers transform and shadow so it
 * lifts rather than snaps — except under `prefers-reduced-motion`, where it
 * simply arrives already lifted.
 */
export const reviewCardClass = (active = false, accent = "border-black/10 dark:border-white/10") =>
  cn(
    "p-3 rounded-lg border flex flex-col gap-2.5 cursor-pointer bg-[var(--editor-secondary-bg)]",
    "transition-[transform,box-shadow,background-color,border-color] duration-200 ease-out motion-reduce:transition-none",
    active
      ? cn(
          "relative z-10 -rotate-3 scale-[1.03] bg-[var(--editor-bg-color)]",
          "shadow-[0_12px_28px_-8px_rgba(0,0,0,0.45),0_4px_10px_-4px_rgba(0,0,0,0.3)]",
          "dark:shadow-[0_12px_28px_-8px_rgba(0,0,0,0.85),0_4px_10px_-4px_rgba(0,0,0,0.6)]",
          accent,
        )
      : cn(accent, "hover:bg-[var(--editor-bg-color)] hover:border-black/10 dark:hover:border-white/10"),
  );

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

export function SuggestionCard({ suggestion: sug, active = false, cardRef, onCardClick, onAcceptSuggestion, onRejectSuggestion, onAddSuggestionReply }: SuggestionCardProps) {
  return (
    <div ref={cardRef} onClick={() => onCardClick(sug)} className={reviewCardClass(active, "border-blue-500/35")}>
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
        {sug.type === 'delete'
          ? <span>Suggest deleting: <span className="line-through text-rose-600 dark:text-rose-400 font-mono text-[11px]">&ldquo;{sug.text}&rdquo;</span></span>
          : <span>Suggest inserting: <span className="text-emerald-600 dark:text-emerald-400 font-mono text-[11px]">&ldquo;{sug.text}&rdquo;</span></span>}
      </div>
      <div className="flex gap-2 mt-1">
        <button title="Accept" onClick={(e) => { e.stopPropagation(); onAcceptSuggestion(sug); }} className={reviewActionClass}><Check className="w-3 h-3" /> Accept</button>
        <button title="Reject" onClick={(e) => { e.stopPropagation(); onRejectSuggestion(sug); }} className={reviewActionClass}><X className="w-3 h-3" /> Reject</button>
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
      <div onClick={(e) => e.stopPropagation()}><ReplyInput onSend={(text) => onAddSuggestionReply(sug.id, text)} /></div>
    </div>
  );
}
