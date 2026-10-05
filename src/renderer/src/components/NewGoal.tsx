import { useEffect, useRef, useState } from 'react'
import { Folder } from 'lucide-react'
import { providerLabel } from '../../../shared/types.ts'
import { closeNewGoal, draftGoal, steerGoal, useApp } from '../store.ts'
import { GoalBrief } from './GoalBrief.tsx'

// A new goal in two steps. Describe: what the user wants, in their own words. Confirm: the brief
// the worker drafted from it. The draft runs in the goal's own chat, so closing the dialog loses
// nothing: the same brief waits in the goal pane beside that chat.
//
// The browser's page is a native view drawn over the window, so it is hidden while this is open
// (BrowserPanel reads `newGoal`), as it would otherwise cover the dialog.

const EXAMPLES = [
  'Fix whatever is making the tests flaky',
  'Add a dark and light theme toggle',
  'Find 20 agencies in Austin and put their contacts in a sheet'
]

function shortPath(path: string): string {
  const home = window.rocket.homeDir
  return path === home ? '~' : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

export function NewGoal() {
  const goalId = useApp((state) => state.newGoal?.goalId ?? null)
  const goal = useApp((state) => state.goals.find((entry) => entry.id === goalId) ?? null)
  // A goal starts where the user is working: the open chat's folder, or the one new chats start in.
  const defaultCwd = useApp((state) => state.chats.find((chat) => chat.id === state.activeChatId)?.cwd ?? state.defaultCwd)
  const provider = useApp((state) => state.provider)
  const [text, setText] = useState('')
  const [cwd, setCwd] = useState(defaultCwd)
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeNewGoal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const draft = async (): Promise<void> => {
    if (!text.trim() || busy) return
    setBusy(true)
    await draftGoal(text, cwd)
    setBusy(false)
  }
  const step = goal ? 2 : 1
  const worker = providerLabel(goal?.worker.provider ?? provider)

  return (
    <div className="scrim" onPointerDown={(event) => { if (event.target === event.currentTarget) closeNewGoal() }}>
      <div className="goal-dialog" role="dialog" aria-modal="true" aria-label="New goal">
        <div className="goal-stepper" aria-hidden>
          <span className={step === 1 ? 'is-on' : ''}>1 Describe</span><i /><span className={step === 2 ? 'is-on' : ''}>2 Confirm</span>
        </div>

        {!goal && (
          <>
            <h2 className="goal-dialog-title">What do you want done?</h2>
            <p className="goal-dialog-sub">Say it however it comes to mind. {worker} turns it into a clear goal and a checklist, and you look it over before anything starts.</p>
            <textarea
              ref={input}
              className="goal-describe"
              aria-label="What do you want done?"
              placeholder="e.g. when I type in the url bar it should find stuff from my history like chrome does"
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault()
                  void draft()
                }
              }}
            />
            <div className="goal-chips">
              <span className="goal-chips-lead">Try:</span>
              {EXAMPLES.map((example) => (
                <button key={example} type="button" className="goal-chip" onClick={() => { setText(example); input.current?.focus() }}>{example}</button>
              ))}
            </div>
            <button
              type="button"
              className="goal-folder"
              title="The folder the goal works in. Click to change."
              onClick={async () => {
                const picked = await window.rocket.pickFolder(cwd)
                if (picked) setCwd(picked)
              }}
            >
              <Folder size={13} /> Works in <span>{shortPath(cwd)}</span>
            </button>
            <div className="brief-foot">
              <span className="brief-note">Nothing runs yet. Continue only drafts a plan.</span>
              <button type="button" className="goal-button" onClick={closeNewGoal}>Cancel</button>
              <button type="button" className="goal-button is-primary" disabled={!text.trim() || busy} onClick={() => void draft()}>Continue</button>
            </div>
          </>
        )}

        {goal?.status === 'drafting' && (
          <div className="goal-drafting" role="status">
            <span className="goal-dot is-run" aria-hidden />
            <span className="shimmer">{worker} is reading the folder and drafting the goal…</span>
            <button type="button" className="goal-button" onClick={closeNewGoal}>Wait in the chat</button>
          </div>
        )}

        {goal?.status === 'needs_you' && !goal.goal && (
          <>
            <h2 className="goal-dialog-title">{worker} has a question</h2>
            <p className="goal-dialog-sub">{goal.reason} Its reply is in the chat behind this window.</p>
            <textarea className="goal-describe is-short" aria-label="Your answer" value={answer} onChange={(event) => setAnswer(event.target.value)} />
            <div className="brief-foot">
              <button type="button" className="goal-button" onClick={closeNewGoal}>Close</button>
              <button
                type="button"
                className="goal-button is-primary"
                disabled={!answer.trim()}
                onClick={async () => { if (await steerGoal(goal.id, answer)) setAnswer('') }}
              >
                Answer
              </button>
            </div>
          </>
        )}

        {goal?.status === 'confirming' && (
          <>
            <h2 className="goal-dialog-title">Is this what you mean?</h2>
            <p className="goal-dialog-sub">Edit anything that is off. The checklist is what “done” means: work carries on until a second model agrees every line is true.</p>
            <GoalBrief goal={goal} onBack={closeNewGoal} />
          </>
        )}

        {goal && !['drafting', 'confirming', 'needs_you'].includes(goal.status) && (
          <div className="goal-drafting">
            <span>{goal.status === 'paused' ? goal.reason : 'The goal is under way.'}</span>
            <button type="button" className="goal-button" onClick={closeNewGoal}>Close</button>
          </div>
        )}
      </div>
    </div>
  )
}
