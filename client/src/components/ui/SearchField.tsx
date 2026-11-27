import { useId } from 'react'

/**
 * A labelled search box with a clear button (feature 042).
 *
 * Every string comes in as a prop, so the page translates it (a component that carried
 * its own words would hard-code a language). The browser's own clear control on
 * `type="search"` is hidden: two would be one too many, and ours has a label in the
 * interface language.
 */
export function SearchField({
  value, onChange, label, placeholder, clearLabel,
}: {
  value: string
  onChange: (next: string) => void
  label: string
  placeholder: string
  clearLabel: string
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type="search"
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          enterKeyHint="search"
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-card border border-hairline bg-surface py-2.5 pl-3 pr-10 text-[13px] text-text
            focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy
            [&::-webkit-search-cancel-button]:hidden"
        />
        {value !== '' && (
          <button
            type="button"
            aria-label={clearLabel}
            onClick={() => onChange('')}
            className="absolute right-1 top-1/2 -translate-y-1/2 px-2 py-1 text-[16px] leading-none text-text-muted"
          >
            ×
          </button>
        )}
      </div>
    </div>
  )
}

export default SearchField
