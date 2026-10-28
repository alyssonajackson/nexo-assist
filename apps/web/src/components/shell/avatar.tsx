type AvatarTone = 'blue' | 'orange' | 'violet' | 'green' | 'gray'
type AvatarSize = 'sm' | 'md' | 'lg'

const TONES: Record<AvatarTone, string> = {
  blue: 'bg-primary-50 text-primary-700',
  orange: 'bg-avatar-orange text-avatar-orange-ink',
  violet: 'bg-avatar-violet text-avatar-violet-ink',
  green: 'bg-avatar-green text-avatar-green-ink',
  gray: 'bg-avatar-gray text-ink-soft',
}

const SIZES: Record<AvatarSize, string> = {
  sm: 'size-8 text-[12px]',
  md: 'size-[34px] text-[12.5px]',
  lg: 'size-[46px] text-[15.5px]',
}

/** "Ana Souza" -> "AS" (first and last name). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0]!.charAt(0)
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : ''
  return (first + last).toUpperCase()
}

type AvatarProps = {
  name: string
  size?: AvatarSize
  tone?: AvatarTone
  online?: boolean
}

export function Avatar({ name, size = 'md', tone = 'blue', online = false }: AvatarProps) {
  return (
    <span
      className={`relative grid shrink-0 place-items-center rounded-full font-bold ${SIZES[size]} ${TONES[tone]}`}
    >
      {initials(name)}
      {online && (
        <span className="absolute right-0 bottom-0 size-[11px] rounded-full bg-success-500 outline outline-2 outline-surface" />
      )}
    </span>
  )
}
