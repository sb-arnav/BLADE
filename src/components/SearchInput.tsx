interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchInput({ value, onChange, placeholder = "Search…" }: Props) {
  return (
    <div className="relative w-full">
      {/* Search icon */}
      <svg
        className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-blade-muted pointer-events-none"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="6.5" cy="6.5" r="5" />
        <line x1="10" y1="10" x2="15" y2="15" />
      </svg>

      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent text-2xs text-blade-secondary placeholder:text-blade-muted rounded-lg border border-transparent focus:border-blade-accent/30 focus:outline-none pl-7 pr-6 py-1.5 transition-colors"
      />

      {/* Clear button */}
      {value && (
        <button
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-blade-muted hover:text-blade-secondary transition-colors"
        >
          <svg
            className="h-3 w-3"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="3" y1="3" x2="13" y2="13" />
            <line x1="13" y1="3" x2="3" y2="13" />
          </svg>
        </button>
      )}
    </div>
  );
}
