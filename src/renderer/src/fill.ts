import '@fontsource-variable/inter'
import './fill.css'
import { FILL_CHIP_HEIGHT, FILL_CHIP_MARGIN, FILL_CHIP_WIDTH, type FillChipAction, type FillChipState, type FillSource, type FillVariant } from '../../shared/fill.ts'

// The chip of "Fill with Rocket". Main shows this page in a transparent view of its own beside the
// field being filled, and owns its state; the page only draws it, opens its two dropdowns and
// reports clicks. It says how tall it is whenever a dropdown opens or closes, so main can size
// the view to fit. Steps, sources and errors come from the model and the web, so they are always
// set as text, never as markup.

const stroke = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"'
const ICONS = {
  check: `<svg width="14" height="14" viewBox="0 0 24 24" ${stroke} stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg>`,
  spark: `<svg width="14" height="14" viewBox="0 0 24 24" ${stroke} stroke-width="2"><path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/></svg>`,
  stop: '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>',
  x: `<svg width="12" height="12" viewBox="0 0 24 24" ${stroke} stroke-width="2.4"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
  undo: `<svg width="13" height="13" viewBox="0 0 24 24" ${stroke} stroke-width="2.2"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>`,
  again: `<svg width="13" height="13" viewBox="0 0 24 24" ${stroke} stroke-width="2.2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`,
  down: `<svg width="10" height="10" viewBox="0 0 24 24" ${stroke} stroke-width="2.6"><path d="m6 9 6 6 6-6"/></svg>`,
  warn: `<svg width="14" height="14" viewBox="0 0 24 24" ${stroke} stroke-width="2.2"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>`
}

const AGAIN: Array<{ variant: FillVariant | 'instructions'; label: string; rule?: boolean }> = [
  { variant: 'voice', label: 'Sound like you' },
  { variant: 'shorter', label: 'Shorter', rule: true },
  { variant: 'more', label: 'More detail' },
  { variant: 'friendlier', label: 'Friendlier' },
  { variant: 'different', label: 'A different take' },
  { variant: 'instructions', label: 'With instructions…', rule: true }
]

const root = document.getElementById('root')!
root.style.setProperty('--width', `${FILL_CHIP_WIDTH}px`)
root.style.setProperty('--height', `${FILL_CHIP_HEIGHT}px`)
root.style.setProperty('--margin', `${FILL_CHIP_MARGIN}px`)

let state: FillChipState | null = null
let open: 'sources' | 'again' | null = null
let clock: ReturnType<typeof setInterval> | null = null

const send = (action: FillChipAction): void => window.rocket.browser.send({ type: 'fill', action })

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function icon(name: keyof typeof ICONS, className = 'mark'): HTMLSpanElement {
  const node = el('span', className)
  node.innerHTML = ICONS[name]
  return node
}

function button(className: string, onClick: () => void, ...children: Array<Node | string>): HTMLButtonElement {
  const node = el('button', `act ${className}`.trim())
  node.append(...children)
  node.addEventListener('click', onClick)
  return node
}

function down(): HTMLSpanElement {
  return icon('down', '')
}

function sourcesButton(sources: FillSource[]): HTMLButtonElement {
  const count = el('span', 'count', String(sources.length))
  const node = button(open === 'sources' ? 'is-open' : '', () => toggle('sources'), 'Sources ', count, down())
  node.setAttribute('aria-expanded', String(open === 'sources'))
  return node
}

function closeButton(label: string): HTMLButtonElement {
  const node = button('x', () => send({ action: 'close' }))
  node.innerHTML = ICONS.x
  node.setAttribute('aria-label', label)
  return node
}

function elapsed(since: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - since) / 1000))
  return seconds < 60 ? `${String(seconds).padStart(2, ' ')}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

function toggle(which: 'sources' | 'again'): void {
  open = open === which ? null : which
  render()
}

function chip(current: FillChipState): HTMLDivElement {
  const box = el('div', 'chip')
  box.setAttribute('role', 'status')
  switch (current.phase) {
    case 'ask': {
      const input = el('input')
      input.placeholder = 'What should it say? e.g. explain why, keep it short'
      input.setAttribute('aria-label', 'Instructions for the fill')
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') send({ action: 'start', instructions: input.value })
      })
      const go = button('', () => send({ action: 'start', instructions: input.value }), 'Fill ', el('kbd', '', '↵'))
      box.append(icon('spark', 'mark accent'), input, el('span', 'model', current.model), go, closeButton('Cancel'))
      requestAnimationFrame(() => input.focus())
      break
    }
    case 'working': {
      const what = el('span', 'what')
      const [verb, ...rest] = current.step.split(' ')
      what.append(`${verb} `, el('b', '', rest.join(' ')), '…')
      what.title = current.step
      const time = el('span', 'clock', elapsed(current.startedAt))
      time.dataset.since = String(current.startedAt)
      time.title = current.model
      box.append(
        el('span', 'mark'), what, time, el('span', 'sep'), sourcesButton(current.sources),
        button('', () => send({ action: 'stop' }), icon('stop', ''), 'Stop')
      )
      box.firstElementChild!.append(el('span', 'spinner'))
      break
    }
    case 'done': {
      const what = el('span', 'what')
      what.append(el('b', '', current.label))
      if (current.warn) what.append(' · ', el('span', 'warn', current.warn))
      what.title = current.detail ?? current.label
      const again = button(open === 'again' ? 'is-open' : '', () => toggle('again'), icon('again', ''), 'Another go ', down())
      box.append(
        icon('check', 'mark ok'), what, el('span', 'sep'),
        ...(current.sources.length ? [sourcesButton(current.sources)] : []),
        again,
        button('', () => send({ action: 'undo' }), icon('undo', ''), 'Undo'),
        closeButton('Dismiss')
      )
      break
    }
    case 'failed': {
      const what = el('span', 'what is-wrapped', current.message)
      box.append(
        icon('warn', 'mark bad'), what, el('span', 'sep'),
        ...(current.alternative ? [button('', () => send({ action: 'alternative' }), current.alternative)] : []),
        button('', () => send({ action: 'retry' }), 'Try again'),
        closeButton('Dismiss')
      )
      break
    }
  }
  return box
}

function dropdown(current: FillChipState): HTMLDivElement | null {
  if (open === 'sources' && (current.phase === 'working' || current.phase === 'done')) {
    const drop = el('div', 'drop')
    drop.append(el('div', 'head', current.phase === 'working' ? 'Opened so far' : 'Opened while filling'))
    if (!current.sources.length) drop.append(el('div', 'empty', 'Nothing opened yet'))
    for (const source of current.sources) {
      const row = el('button', `item${source.url ? '' : ' is-plain'}`)
      row.append(
        el('span', 'glyph', source.kind === 'command' ? '$' : (source.detail[0] ?? '·').toUpperCase()),
        el('span', 'title', source.title),
        el('span', 'detail', source.detail)
      )
      if (source.url) {
        row.title = source.url
        row.addEventListener('click', () => send({ action: 'openSource', url: source.url! }))
      }
      drop.append(row)
    }
    return drop
  }
  if (open === 'again' && current.phase === 'done') {
    const drop = el('div', 'drop')
    for (const entry of AGAIN) {
      const row = el('button', `item${entry.rule ? ' is-rule' : ''}`, entry.label)
      row.addEventListener('click', () => {
        open = null
        send(entry.variant === 'instructions' ? { action: 'instructions' } : { action: 'again', variant: entry.variant })
      })
      drop.append(row)
    }
    return drop
  }
  return null
}

let reported = 0
function render(): void {
  if (!state) {
    root.replaceChildren()
    return
  }
  const drop = dropdown(state)
  root.replaceChildren(chip(state), ...(drop ? [drop] : []))
  // The view is sized to what is drawn: the chip, and the dropdown when one is open.
  const height = Math.ceil(root.getBoundingClientRect().height) - FILL_CHIP_MARGIN * 2
  if (height !== reported) {
    reported = height
    send({ action: 'size', height })
  }
}

window.rocket.browser.onFill((next) => {
  // A new phase closes whatever dropdown was open; within a phase (a new step) it stays.
  if (state?.phase !== next.phase) open = null
  state = next
  render()
  if (clock) clearInterval(clock)
  clock = next.phase === 'working' ? setInterval(() => {
    const time = root.querySelector<HTMLElement>('.clock')
    if (time?.dataset.since) time.textContent = elapsed(Number(time.dataset.since))
  }, 1000) : null
})

// A click outside the chip and its dropdown, in the view's transparent margin, closes the dropdown.
document.addEventListener('mousedown', (event) => {
  if (open && !(event.target as Element).closest('.chip, .drop')) {
    open = null
    render()
  }
})
