import React from "react";
import { cn } from "../../lib/utils";
import type { Stage } from "../../types";

interface StageSwitcherProps {
  stage: Stage;
  reprCounter: number;
  onSwitch: (s: Stage) => void;
}

export function StageSwitcher({ stage, reprCounter, onSwitch }: StageSwitcherProps) {
  return (
    <div className="flex gap-1 mb-6 justify-end bg-[var(--editor-secondary-bg)] rounded-xl p-1 border border-black/5 dark:border-white/5 shadow-sm self-end">
      {["draft", "write", "revise"].map((s) => (
        <button
          key={s}
          onClick={() => onSwitch(s as Stage)}
          className={cn(
            "px-3 py-1 text-[11px] font-semibold rounded-lg capitalize transition cursor-pointer relative",
            stage === s
              ? "text-[var(--editor-text-color)] bg-white/60 dark:bg-white/10 shadow-sm border border-black/5 dark:border-white/10"
              : "text-[var(--editor-text-color)] opacity-60 hover:opacity-95 hover:bg-black/5 dark:hover:bg-white/5",
          )}
        >
          {s}
          {s === "revise" && reprCounter > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] flex items-center justify-center bg-amber-500 text-white text-[8px] font-bold rounded-full px-[3px] leading-none shadow-sm">
              {reprCounter}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
