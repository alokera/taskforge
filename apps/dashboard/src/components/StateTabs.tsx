import type { JobCounts, JobState } from "@taskforge/core";
import { STATE_STYLES, STATES } from "@/lib/format";

interface Props {
  counts: JobCounts | null;
  selected: JobState;
  onSelect: (state: JobState) => void;
}

export function StateTabs({ counts, selected, onSelect }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {STATES.map((state) => {
        const style = STATE_STYLES[state];
        const isSelected = state === selected;
        return (
          <button
            key={state}
            type="button"
            onClick={() => onSelect(state)}
            className={`rounded-xl border p-4 text-left transition ${
              isSelected
                ? "border-neutral-900 bg-white shadow-sm dark:border-neutral-100 dark:bg-neutral-900"
                : "border-neutral-200 hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
            }`}
          >
            <div className="flex items-center gap-2 text-sm text-neutral-500">
              <span className={`h-2 w-2 rounded-full ${style.dot} ${state === "active" && counts?.active ? "animate-pulse" : ""}`} />
              {style.label}
            </div>
            <div className="mt-1 text-3xl font-semibold tabular-nums">{counts ? counts[state].toLocaleString() : "–"}</div>
          </button>
        );
      })}
    </div>
  );
}
