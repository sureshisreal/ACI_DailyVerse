import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, X } from 'lucide-react';
import planData from '../data/verse-plan-2026-oct-dec.json';

// Daily verse plan (1 Oct - 31 Dec 2026), mirrored from output/verse-plan-2026-oct-dec.md/.json.
// Lives in data/ (not output/, which is gitignored) so it ships with the repo, e.g. to Codespaces.
export interface VersePlanEntry {
  date: string;        // YYYY-MM-DD
  day: string;
  theme: string;
  themeDesc: string;
  reference: string;
  hook: string;
  occasion: string;
  text: { en: string; ta: string; te: string };
}

export const VERSE_PLAN = planData as VersePlanEntry[];
const PLAN_BY_DATE = new Map(VERSE_PLAN.map((e) => [e.date, e]));
export const getPlanEntry = (date: string) => PLAN_BY_DATE.get(date);

const THEME_COLORS: Record<string, string> = {
  Comfort: 'text-rose-300 border-rose-700/60 bg-rose-900/20',
  Encourage: 'text-orange-300 border-orange-700/60 bg-orange-900/20',
  Guidance: 'text-sky-300 border-sky-700/60 bg-sky-900/20',
  Support: 'text-violet-300 border-violet-700/60 bg-violet-900/20',
  Hope: 'text-emerald-300 border-emerald-700/60 bg-emerald-900/20',
  Peace: 'text-teal-300 border-teal-700/60 bg-teal-900/20',
  Thanksgiving: 'text-amber-300 border-amber-700/60 bg-amber-900/20',
};
const themeClass = (t: string) => THEME_COLORS[t] || 'text-stone-300 border-stone-700 bg-stone-800/40';

const monthLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { day: '2-digit', month: 'short' });

interface Props {
  label: string;
  selectedDate: string;
  today: string;
  disabled?: boolean;
  onPick: (entry: VersePlanEntry) => void;
}

/** "Verse plan" button + panel listing every planned day; clicking a day fills date + reference. */
const VersePlanPicker: React.FC<Props> = ({ label, selectedDate, today, disabled, onPick }) => {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const months = useMemo(() => {
    const groups: { label: string; entries: VersePlanEntry[] }[] = [];
    for (const e of VERSE_PLAN) {
      const label = monthLabel(e.date);
      if (groups[groups.length - 1]?.label !== label) groups.push({ label, entries: [] });
      groups[groups.length - 1].entries.push(e);
    }
    return groups;
  }, []);

  // On open, scroll to the selected date (or today, or the first upcoming day).
  useEffect(() => {
    if (!open) return;
    const target =
      (PLAN_BY_DATE.has(selectedDate) && selectedDate) ||
      VERSE_PLAN.find((e) => e.date >= today)?.date ||
      VERSE_PLAN[VERSE_PLAN.length - 1]?.date;
    const centerTarget = () => {
      const list = listRef.current;
      const row = list?.querySelector<HTMLElement>(`[data-date="${target}"]`);
      if (list && row) list.scrollTop = Math.max(0, row.offsetTop - list.clientHeight / 2 + row.offsetHeight / 2);
    };
    centerTarget();
    // Re-center once the Tailwind Play CDN has generated styles for newly-rendered classes (row heights shift).
    const timer = setTimeout(centerTarget, 150);
    return () => clearTimeout(timer);
  }, [open, selectedDate, today]);

  return (
    <div className="mb-2">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-bold uppercase tracking-widest text-stone-500">{label}</label>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          open ? 'bg-amber-600/20 border-amber-600 text-amber-400' : 'bg-stone-900 border-stone-700 text-stone-300 hover:border-amber-600'
        }`}
      >
        <CalendarDays className="w-3.5 h-3.5" />
        Verse plan
      </button>
      </div>

      {open && (
        <div className="mt-3 rounded-2xl border border-stone-700 bg-stone-950/80 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-800">
            <span className="text-sm font-semibold text-amber-400">Verse plan · Oct – Dec 2026</span>
            <button type="button" onClick={() => setOpen(false)} className="p-1 text-stone-400 hover:text-stone-200" aria-label="Close verse plan">
              <X className="w-4 h-4" />
            </button>
          </div>
          {/* maxHeight/overflow inline, not Tailwind classes: the Play CDN generates new classes asynchronously,
              so on first open the list wouldn't be scrollable yet when the scroll-to-today effect runs. */}
          <div ref={listRef} className="relative" style={{ maxHeight: '24rem', overflowY: 'auto' }}>
            {months.map((m) => (
              <div key={m.label}>
                <div className="sticky top-0 z-10 px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest text-stone-500 bg-stone-950/95 backdrop-blur">
                  {m.label}
                </div>
                {m.entries.map((e) => {
                  const isSelected = e.date === selectedDate;
                  const isToday = e.date === today;
                  const isPast = e.date < today;
                  return (
                    <button
                      key={e.date}
                      type="button"
                      data-date={e.date}
                      onClick={() => { onPick(e); setOpen(false); }}
                      className={`w-full text-left px-4 py-2.5 flex gap-3 items-start border-l-2 transition-colors ${
                        isSelected ? 'border-amber-500 bg-amber-600/10' : 'border-transparent hover:bg-stone-800/60'
                      } ${isPast && !isSelected ? 'opacity-60' : ''}`}
                    >
                      <div className="w-14 shrink-0 text-center">
                        <div className="text-sm font-semibold text-stone-200">{shortDate(e.date)}</div>
                        <div className="text-[11px] text-stone-500">{e.day.slice(0, 3)}</div>
                        {isToday && <div className="mt-0.5 text-[10px] font-bold uppercase text-amber-500">Today</div>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-medium text-amber-300">{e.reference}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${themeClass(e.theme)}`}>{e.theme}</span>
                          {e.occasion && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded border border-fuchsia-700/60 bg-fuchsia-900/20 text-fuchsia-300">
                              {e.occasion}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-stone-400 truncate">{e.hook}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default VersePlanPicker;
