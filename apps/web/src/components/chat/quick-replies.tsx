type QuickRepliesProps = {
  options: string[]
  selected?: string
  disabled: boolean
  onPick: (option: string) => void
}

/** Answer chips inside the agent bubble; picking one sends its text. */
export function QuickReplies({ options, selected, disabled, onPick }: QuickRepliesProps) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Respostas rápidas">
      {options.map((option) => {
        const isSelected = option === selected
        return (
          <button
            key={option}
            type="button"
            disabled={disabled}
            aria-pressed={isSelected}
            onClick={() => onPick(option)}
            className={`rounded-md px-3 py-[7px] text-[13.5px] font-medium outline outline-1 -outline-offset-[.5px] disabled:cursor-default ${
              isSelected
                ? 'bg-primary-50 text-primary-700 outline-primary-500'
                : 'bg-surface text-ink outline-border enabled:hover:bg-surface-muted enabled:hover:outline-border-strong disabled:text-ink-muted'
            }`}
          >
            {option}
          </button>
        )
      })}
    </div>
  )
}
