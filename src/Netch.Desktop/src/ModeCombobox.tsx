import { useEffect, useMemo, useRef, useState } from "react";
import { filterModes, modeLabel, modeOriginLabel, type ModeSummary } from "./engine";
import { SearchIcon } from "./icons";

interface ModeComboboxProps {
  modes: ModeSummary[];
  selectedId: number | null;
  disabled?: boolean;
  onSelect: (modeId: number | null) => void;
}

export function ModeCombobox({ modes, selectedId, disabled, onSelect }: ModeComboboxProps) {
  const selected = modes.find((mode) => mode.id === selectedId) ?? null;
  const [query, setQuery] = useState(selected ? modeLabel(selected) : "");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const results = useMemo(() => filterModes(modes, query), [modes, query]);

  useEffect(() => {
    if (!open) setQuery(selected ? modeLabel(selected) : "");
  }, [selectedId, selected, open]);

  function choose(mode: ModeSummary) {
    onSelect(mode.id);
    setQuery(modeLabel(mode));
    setOpen(false);
    setActiveIndex(0);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => open ? Math.min(current + 1, Math.max(results.length - 1, 0)) : 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => open ? Math.max(current - 1, 0) : Math.max(results.length - 1, 0));
    } else if (event.key === "Enter" && open && results[activeIndex]) {
      event.preventDefault();
      choose(results[activeIndex]);
    } else if (event.key === "Escape") {
      setOpen(false);
      setQuery(selected ? modeLabel(selected) : "");
    }
  }

  return (
    <div
      className="mode-combobox"
      onBlur={(event) => {
        if (!root.current?.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
          setQuery(selected ? modeLabel(selected) : "");
        }
      }}
      ref={root}
    >
      <label htmlFor="connection-mode-search">Mode</label>
      <div className="mode-combobox-input">
        <SearchIcon />
        <input
          aria-autocomplete="list"
          aria-controls="connection-mode-results"
          aria-expanded={open}
          aria-haspopup="listbox"
          autoComplete="off"
          disabled={disabled}
          id="connection-mode-search"
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(0);
            onSelect(null);
          }}
          onFocus={(event) => {
            setOpen(true);
            event.currentTarget.select();
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search and choose a mode"
          role="combobox"
          value={query}
        />
        {query && !disabled && (
          <button aria-label="Clear mode selection" onClick={() => { setQuery(""); onSelect(null); setOpen(true); }} type="button">×</button>
        )}
      </div>
      {open && !disabled && (
        <div className="mode-combobox-results" id="connection-mode-results" role="listbox">
          <span className="combobox-result-count">{results.length} result{results.length === 1 ? "" : "s"}</span>
          {results.slice(0, 100).map((mode, index) => (
            <button
              aria-selected={mode.id === selectedId}
              className={index === activeIndex ? "active" : ""}
              key={mode.source}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(mode)}
              role="option"
              type="button"
            >
              <span><strong>{modeLabel(mode)}</strong><small>{mode.type === "ProcessMode" ? "Process" : mode.type === "TunMode" ? "TUN" : "Sharing"} · {modeOriginLabel(mode.origin)}</small></span>
            </button>
          ))}
          {!results.length && <p>No modes match your search.</p>}
          {results.length > 100 && <small>Showing the first 100 results. Refine the search to narrow the list.</small>}
        </div>
      )}
    </div>
  );
}
