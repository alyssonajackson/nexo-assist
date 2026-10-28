# Design notes

Source: pen.dev exports. Tokens live in `apps/web/src/styles/theme.css`. Layout is 1440x900 desktop; sidebar 231px, analyst rail 64px.

## Fonts (next/font/google)

- Sans: `Schibsted_Grotesk`, weights 400-700 (variable 400..900), variable `--font-schibsted`. Used for everything.
- Serif: `Newsreader`, weight 400 (variable 200..800), variable `--font-newsreader`. Only login: headline 34px, "Entrar" title 40px/44px, tracking -0.6/-0.8px.

## Palette

| Token                  | Value             | Use                                     |
| ---------------------- | ----------------- | --------------------------------------- |
| ink / navy-900         | #1B2431           | main text, login panel, employee bubble |
| ink-soft               | #3D4656           | inactive nav, secondary text            |
| ink-muted              | #5B6472           | captions, meta (most frequent)          |
| primary-600            | #0062C4           | buttons, badges, send                   |
| primary-700            | #0069C7           | active nav text, selected chip text     |
| primary-500            | #0285F7           | selected outline, info dot              |
| primary-50             | #0285F712         | active nav / selected chip / avatar bg  |
| warning-500 / 700      | #F5A500 / #946300 | pending dot / label                     |
| success-500 / 700      | #00BD6C / #00804A | online, resolved                        |
| danger-500 / 700       | #EE343B / #C4161D | critical, close                         |
| surface-muted          | #F6F7F9           | rails, inputs, card footers             |
| surface-canvas         | #EEF1F5           | console conversation bg                 |
| border                 | #E6E8EC           | dividers, outlines                      |
| bubble-agent / analyst | #E6EFFA / #E3F4EA | console bubbles                         |

## Typography (Schibsted Grotesk)

11 / 11.5px labels and tags (600) - 12.5px meta, counters, status labels - 13.5px nav, buttons, chips (500/600) - 14.5px/22px chat body (400) - 15.5px list names (600) - 16px brand (700, -0.2px) - 18-24px headings.

## Recipes

- Primary button: `h-9 px-3.5 rounded-md bg-primary-600 text-white text-[13.5px] font-semibold hover:bg-primary-hover`; login CTA adds `h-11 shadow-cta`.
- Secondary button: `h-9 px-3.5 rounded-md bg-surface text-ink text-[13.5px] font-medium shadow-button outline outline-1 -outline-offset-[.5px] outline-border-strong`.
- Quick reply chip: `px-3 py-[7px] rounded-md bg-surface outline outline-1 -outline-offset-[.5px] outline-border text-[13.5px] font-medium text-ink`. Selected: `bg-primary-50 outline-primary-500 text-primary-700`.
- Status: `<span class="size-1.5 rounded-full bg-warning-500"/>` + `text-[12.5px] font-medium text-warning-700`. Same with success-500/700, primary-500/700 (info), danger-500/700. Closed: dot `bg-ink/40`, label `text-ink-muted`.
- Ticket card: `rounded-xl bg-surface shadow-card outline outline-1 -outline-offset-[.5px] outline-border-card overflow-hidden`; selected row `bg-primary-600/5 h-[46px] px-4`.
- Draft card footer: `flex gap-1.5 p-2 pr-3.5 bg-surface-muted border-t border-border` with primary "Confirmar" + secondary "Editar".
- Nav item: `h-9 px-2.5 gap-2.5 rounded-md text-[13.5px]`. Active: `bg-primary-50 text-primary-700 font-semibold`. Inactive: `text-ink-soft font-medium`.
- Employee bubble: `max-w-[520px] px-4 py-[11px] bg-bubble-employee text-white text-[14.5px] rounded-[12px_12px_4px_12px]`.
- Agent bubble: `max-w-[600px] px-4 py-3 bg-surface outline outline-1 -outline-offset-[.5px] outline-border text-ink text-[14.5px]/[22px] rounded-[4px_12px_12px_12px]`. Action chips row above: `text-[12.5px] text-ink-muted` with "Agent" label `font-semibold text-ink`.
- Console bubbles (`shadow-bubble px-3 pt-2 pb-1.5`): employee `bg-surface rounded-[4px_12px_12px_12px]`; agent `bg-bubble-agent rounded-[12px_4px_12px_12px]`; analyst `bg-bubble-analyst rounded-[12px_4px_12px_12px]`.
- System divider: `flex items-center gap-3 text-[11.5px] text-ink-muted` with lines `flex-1 h-px bg-ink/10`.
- Avatar: `size-[46px] rounded-full bg-avatar-blue text-primary-700 text-[15.5px] font-semibold grid place-items-center relative`; online dot `absolute left-[34px] top-[34px] size-[11px] rounded-full bg-success-500 outline outline-2 outline-surface`.
- Filter tabs: `flex gap-1.5 px-[9px] py-1.5 rounded-pill text-[12.5px] bg-surface-muted text-ink-soft`; active `bg-primary-50 text-primary-700`; count is a trailing number in the same pill. Unread badge: `h-5 px-1.5 rounded-pill bg-primary-600 text-white text-[11px]`.
- Input bar: `h-12 pl-4 pr-1.5 gap-2 rounded-lg bg-surface outline outline-1 -outline-offset-[.5px] outline-border-strong`; send `h-9 px-3 rounded-sm bg-primary-600 text-white` (console: `size-11 rounded-pill`, input `bg-surface-muted rounded-lg`). Counter "n/30": `text-[12.5px] text-ink-muted`.

## Ambiguities

- Hover/focus/disabled states are not in the exports. Analyst bubble #E3F4EA appears once. Alpha tokens (`#0285F712`) rely on Tailwind v4 accepting 8-digit hex.
