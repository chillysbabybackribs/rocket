// The page's half of "Fill with Rocket" (page-fill.ts is main's). It runs in an isolated world of
// its own, so the page cannot see or call it, while the DOM it reads and writes is the page's.
// It finds the field under the pointer and the form around it, describes them for the model,
// outlines them while Rocket works, writes the answer in and puts the old text back on undo.
//
// Text goes in the way typing would, so a page's own editor hears about it: a text box takes
// `insertText`, which also lands on its undo stack (Ctrl+Z works); a rich editor (contenteditable,
// such as Lexical or ProseMirror) is first offered the text as a paste, which these editors turn
// into their own paragraphs, then `insertText` if it ignores the paste.

/** Any id but 0 (the page's), 999 (Electron's preload world) and the reading scroll's 1207. */
export const FILL_WORLD = 1208

export type ProbedField = {
  id: string; label: string; kind: 'line' | 'text' | 'rich'; inputType: string; value: string
  placeholder: string; required: boolean; maxLength: number | null; selector: string
}
export type Probe = {
  /** The field under the pointer, when it is one Rocket can fill. */
  field: ProbedField[] | null
  /** Why the field under the pointer is not one Rocket fills (a password), or null. */
  blocked: string | null
  /** The fields of the form around the pointer, when there are two or more. */
  form: ProbedField[] | null
  skipped: Array<{ label: string; reason: string }>
  context: string
}
export type FieldRect = { x: number; y: number; width: number; height: number; viewWidth: number; viewHeight: number; connected: boolean; edited: boolean; awayAt: number }

/** The page's half. Its source is sent to the page, so it must stand alone: nothing from outside its body. */
export function fillLib(): void {
  const scope = globalThis as unknown as { __rocketFill?: unknown }
  if (scope.__rocketFill) return

  type Field = HTMLInputElement | HTMLTextAreaElement | HTMLElement
  const LINE_TYPES = ['text', 'search', 'email', 'url', 'tel', 'number', '']
  let candidates: { field: Field[]; form: Field[] } = { field: [], form: [] }
  let active: Field[] = []
  /** What each field held once filled. A rich editor may tidy the text just after, so it settles first. */
  const applied = new Map<Field, { text: string; at: number }>()
  const SETTLE_MS = 800
  const outlines = new Map<Field, { outline: string; offset: string }>()
  let awayAt = 0

  document.addEventListener('mousedown', (event) => {
    const target = event.target as Node | null
    if (!active.some((field) => target && field.contains(target))) awayAt = Date.now()
  }, true)

  const isInput = (el: Element): el is HTMLInputElement => el instanceof HTMLInputElement
  const isArea = (el: Element): el is HTMLTextAreaElement => el instanceof HTMLTextAreaElement

  /** The element under the point, through open shadow roots. */
  function deepAt(x: number, y: number): Element | null {
    let el = document.elementFromPoint(x, y)
    while (el?.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(x, y)
      if (!inner || inner === el) break
      el = inner
    }
    return el
  }

  /** The editable root the element is in: an input, a textarea or the outermost contenteditable. */
  function editableOf(el: Element | null): Field | null {
    if (!el) return null
    const box = el.closest('input, textarea')
    if (box) return box as Field
    let node: HTMLElement | null = el instanceof HTMLElement && el.isContentEditable ? el : null
    while (node?.parentElement?.isContentEditable) node = node.parentElement
    return node
  }

  /** Why Rocket leaves a field alone, or null when it fills it. */
  function refusal(el: Field): string | null {
    if (isInput(el)) {
      const type = (el.getAttribute('type') || '').toLowerCase()
      if (type === 'password') return 'a password'
      if (!LINE_TYPES.includes(type)) return 'not a text field'
    }
    const auto = (el.getAttribute('autocomplete') || '').toLowerCase()
    if (/cc-|card|cvc|csc/.test(auto) || /card.?number|cvc|cvv|security.?code/i.test(`${el.getAttribute('name') || ''} ${el.id}`)) return 'payment details'
    if ((isInput(el) || isArea(el)) && (el.disabled || el.readOnly)) return 'not editable'
    return null
  }

  function visible(el: Element): boolean {
    const rect = el.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return false
    const style = getComputedStyle(el)
    return style.visibility !== 'hidden' && style.display !== 'none'
  }

  const clip = (text: string, max: number): string => {
    const flat = text.replace(/\s+/g, ' ').trim()
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
  }

  function labelOf(el: Field): string {
    const by = el.getAttribute('aria-labelledby')
    const named = by ? by.split(/\s+/).map((id) => document.getElementById(id)?.innerText ?? '').join(' ') : ''
    const own = (isInput(el) || isArea(el)) ? [...(el.labels ?? [])].map((label) => label.innerText).join(' ') : ''
    const wrapping = el.closest('label')?.innerText ?? ''
    return clip(
      el.getAttribute('aria-label') || named || own || wrapping || el.getAttribute('placeholder') || el.getAttribute('aria-placeholder')
        || el.getAttribute('data-placeholder') || el.getAttribute('title') || el.getAttribute('name') || '',
      80
    )
  }

  function read(el: Field): string {
    return isInput(el) || isArea(el) ? el.value : el.innerText.replace(/\n$/, '')
  }

  function selectorOf(el: Element): string {
    const parts: string[] = []
    let node: Element | null = el
    while (node && node !== document.documentElement && parts.length < 6) {
      if (node.id && document.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) {
        parts.unshift(`#${CSS.escape(node.id)}`)
        break
      }
      const tag = node.tagName.toLowerCase()
      const parent: Element | null = node.parentElement
      const same = parent ? [...parent.children].filter((child) => child.tagName === node!.tagName) : []
      parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(node) + 1})` : tag)
      node = parent
    }
    return parts.join(' > ')
  }

  function describe(list: Field[]): ProbedField[] {
    return list.map((el, index) => ({
      id: `f${index + 1}`,
      label: labelOf(el),
      kind: isInput(el) ? 'line' : isArea(el) ? 'text' : 'rich',
      inputType: isInput(el) ? (el.getAttribute('type') || 'text').toLowerCase() : '',
      value: read(el).slice(0, 20_000),
      placeholder: clip(el.getAttribute('placeholder') || el.getAttribute('aria-placeholder') || el.getAttribute('data-placeholder') || '', 120),
      required: (isInput(el) || isArea(el)) ? el.required : el.getAttribute('aria-required') === 'true',
      maxLength: (isInput(el) || isArea(el)) && el.maxLength > 0 ? el.maxLength : null,
      selector: selectorOf(el)
    }))
  }

  /** The fillable fields of the form around an element: its <form>, or the nearest ancestor holding two or more. */
  function formAround(el: Element): { fields: Field[]; skipped: Array<{ label: string; reason: string }> } {
    const all = (root: Element): Field[] => [...root.querySelectorAll('input, textarea, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]')]
      .map((node) => editableOf(node))
      .filter((node, index, list): node is Field => node !== null && list.indexOf(node) === index && visible(node))
    let root: Element | null = el.closest('form')
    if (!root) {
      for (let node: Element | null = el, depth = 0; node && node !== document.body && depth < 8; node = node.parentElement, depth++) {
        if (all(node).filter((field) => !refusal(field)).length >= 2) { root = node; break }
      }
    }
    if (!root) return { fields: [], skipped: [] }
    const fields: Field[] = []
    const skipped: Array<{ label: string; reason: string }> = []
    for (const field of all(root)) {
      const why = refusal(field)
      if (!why) fields.push(field)
      else if (why !== 'not a text field' && why !== 'not editable') skipped.push({ label: labelOf(field) || 'unlabelled', reason: why })
    }
    return { fields, skipped }
  }

  /** An element's parent, stepping out of a shadow root to its host (comment boxes are often web components). */
  function parentOf(node: Element): Element | null {
    return node.parentElement ?? ((node.getRootNode() as ShadowRoot).host || null)
  }

  /** The text around an element: the nearest ancestor with enough to say what the field answers. */
  function contextOf(el: Element): string {
    const heading = clip(document.querySelector('h1')?.textContent ?? '', 200)
    let around = ''
    for (let node: Element | null = parentOf(el), depth = 0; node && depth < 14; node = parentOf(node), depth++) {
      const text = (node as HTMLElement).innerText ?? ''
      around = text
      if (text.replace(/\s+/g, ' ').length >= 600) break
    }
    around = around.replace(/\n{3,}/g, '\n\n').trim()
    if (around.length > 4_000) around = `${around.slice(0, 1_600)}\n…\n${around.slice(-2_400)}`
    return heading && !around.includes(heading) ? `Page heading: ${heading}\n\n${around}` : around
  }

  function setOutline(el: Field, value: string | null): void {
    if (value === null) {
      const kept = outlines.get(el)
      if (!kept) return
      el.style.outline = kept.outline
      el.style.outlineOffset = kept.offset
      outlines.delete(el)
      return
    }
    if (!outlines.has(el)) outlines.set(el, { outline: el.style.outline, offset: el.style.outlineOffset })
    el.style.setProperty('outline', value, 'important')
    el.style.setProperty('outline-offset', '2px', 'important')
  }

  async function write(el: Field, text: string): Promise<void> {
    el.focus()
    if (isInput(el) || isArea(el)) {
      el.select()
      const typed = text ? document.execCommand('insertText', false, text) : document.execCommand('delete')
      if (!typed || el.value !== text) {
        // A field that refuses the command still takes its value the way a framework watches for it.
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set
        setter?.call(el, text)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }
      return
    }
    const selection = getSelection()
    selection?.selectAllChildren(el)
    // Editors such as Lexical keep their own copy of the selection and update it on
    // selectionchange, which fires after this task; a paste sent at once lands where the caret was.
    await new Promise((resolve) => setTimeout(resolve, 50))
    if (!text) {
      document.execCommand('delete')
      return
    }
    const data = new DataTransfer()
    data.setData('text/plain', text)
    const paste = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
    el.dispatchEvent(paste)
    if (!paste.defaultPrevented) document.execCommand('insertText', false, text)
  }

  scope.__rocketFill = {
    probe(x: number, y: number): Probe {
      const at = deepAt(x, y)
      const editable = editableOf(at)
      const blocked = editable ? refusal(editable) : null
      const { fields, skipped } = at ? formAround(editable ?? at) : { fields: [], skipped: [] }
      candidates = { field: editable && !blocked ? [editable] : [], form: fields.length >= 2 ? fields : [] }
      return {
        field: candidates.field.length ? describe(candidates.field) : null,
        blocked: editable && blocked ? blocked : null,
        form: candidates.form.length ? describe(candidates.form) : null,
        skipped,
        context: at ? contextOf(editable ?? at) : ''
      }
    },
    /** Make the field or the form from the last probe the one Rocket works on. */
    choose(mode: 'field' | 'form'): ProbedField[] {
      for (const field of active) setOutline(field, null)
      active = candidates[mode]
      applied.clear()
      awayAt = 0
      return describe(active)
    },
    /** What the fields hold now, by id. */
    values(): Record<string, string> {
      return Object.fromEntries(active.map((field, index) => [`f${index + 1}`, read(field)]))
    },
    /** Write the answer in; returns what each field held before. */
    async apply(values: Record<string, string>): Promise<Record<string, string>> {
      const before: Record<string, string> = {}
      for (const [index, field] of active.entries()) {
        const id = `f${index + 1}`
        if (!(id in values) || !field.isConnected) continue
        before[id] = read(field)
        await write(field, values[id]!)
        applied.set(field, { text: read(field), at: Date.now() })
      }
      return before
    },
    /** Outline the fields: working, done, or none; the ones in `left` are marked for the user. */
    mark(state: 'working' | 'done' | 'none', left: string[] = []): void {
      active.forEach((field, index) => {
        if (state === 'none') setOutline(field, null)
        else if (left.includes(`f${index + 1}`)) setOutline(field, '2px dashed #e2a33d')
        else setOutline(field, state === 'working' ? '2px solid #7170ff' : '2px solid rgba(76, 183, 130, 0.85)')
      })
    },
    /** Where the first field is in the viewport, and whether the user has since typed in a filled one or clicked elsewhere. */
    rect(): FieldRect | null {
      const first = active[0]
      if (!first) return null
      const box = first.getBoundingClientRect()
      let edited = false
      for (const [field, entry] of applied) {
        if (Date.now() - entry.at < SETTLE_MS) entry.text = read(field)
        else if (read(field) !== entry.text) edited = true
      }
      return { x: box.x, y: box.y, width: box.width, height: box.height, viewWidth: innerWidth, viewHeight: innerHeight, connected: first.isConnected, edited, awayAt }
    },
    release(): void {
      for (const field of active) setOutline(field, null)
      active = []
      applied.clear()
    }
  }
}

export const FILL_LIB = `(${fillLib.toString()})()`
