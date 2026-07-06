import React from "react";
import { Check } from "lucide-react";
import { cn } from "../../lib/utils";

interface FocusModeToggleProps {
  focusMode: boolean;
  focusSessionWords: number;
  wordCount: number;
  onToggle: () => void;
}

export function FocusModeToggle({ focusMode, focusSessionWords, wordCount, onToggle }: FocusModeToggleProps) {
  return (
    <div className="absolute bottom-5 left-0 right-0 px-4 flex flex-col items-end gap-1.5 z-10">
      <button
        onClick={onToggle}
        title={focusMode ? "Exit focus mode" : "Enter focus mode"}
        className="flex items-center gap-2 select-none group"
      >
        <span className="text-[11px] text-gray-400 font-medium group-hover:text-gray-500 transition-colors">
          focus mode
        </span>
        <span className={cn(
          "w-5 h-5 rounded-full flex items-center justify-center transition-colors",
          focusMode ? "bg-emerald-500" : "bg-gray-900"
        )}>
          <Check className="w-3 h-3 text-white" />
        </span>
      </button>

      {(focusMode || focusSessionWords > 0) && (
        <div className="text-[11px] text-gray-400 font-medium">
          {focusSessionWords.toLocaleString()} words in focus
        </div>
      )}

      <div className="text-[11px] text-gray-400 font-medium">
        {wordCount.toLocaleString()} words total
      </div>
    </div>
  );
}
