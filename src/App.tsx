import { useEffect, useState } from 'react'
import './App.css'
import { apiIsConfigured, ensureSession, listExpenses } from './services/api'

type View = 'home' | 'activity' | 'room'
type Overlay = 'add' | 'expense' | 'pay' | 'rooms' | 'leave' | null

type Expense = {
  id: number
  title: string
  amount: number
  paidBy: string
  date: string
  note: string
  edited?: boolean
}

const initialExpenses: Expense[] = [
  { id: 1, title: 'Groceries', amount: 1840, paidBy: 'Akshay', date: 'Today', note: 'Weekly grocery run' },
  { id: 2, title: 'Electricity', amount: 2430, paidBy: 'Rahul', date: 'Yesterday', note: 'September electricity bill' },
  { id: 3, title: 'Milk & eggs', amount: 260, paidBy: 'Priya', date: 'Sep 28', note: 'Morning essentials' },
]
const members = ['Akshay', 'Rahul', 'Priya', 'Aman']

const money = (amount: number) => `₹${amount.toLocaleString('en-IN')}`

function App() {
  const [view, setView] = useState<View>('home')
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [expenses, setExpenses] = useState(initialExpenses)
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null)
  const [toast, setToast] = useState('')
  const [joinRequest, setJoinRequest] = useState(true)

  useEffect(() => {
    if (!apiIsConfigured) return
    void (async () => {
      try {
        await ensureSession('Akshay')
        const result = await listExpenses('GP7K29')
        setExpenses(result.expenses.filter((expense) => !expense.voidedAt).map((expense) => ({
          id: Number.parseInt(expense._id.slice(-8), 16),
          title: expense.description,
          amount: expense.amountPaise / 100,
          paidBy: typeof expense.payerId === 'string' ? 'Roommate' : expense.payerId.displayName,
          date: new Date(expense.expenseDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
          note: '',
        })))
      } catch {
        showToast('We could not load the room. Showing the local preview.')
      }
    })()
  }, [])

  function showToast(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(''), 2600)
  }

  const addExpense = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const title = String(form.get('title') || 'New expense')
    const amount = Number(form.get('amount')) || 0
    setExpenses([{ id: Date.now(), title, amount, paidBy: 'Akshay', date: 'Just now', note: 'Added from the room', edited: false }, ...expenses])
    setOverlay(null)
    showToast(`${title} added to the room`)
  }

  const openExpense = (expense: Expense) => {
    setSelectedExpense(expense)
    setOverlay('expense')
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView('home')} aria-label="Go to home">
          <span className="brand-mark">ff</span><span>flatmate finance</span>
        </button>
        <nav className="desktop-nav" aria-label="Desktop navigation">
          <NavButton active={view === 'home'} label="Home" icon="" onClick={() => setView('home')} />
          <NavButton active={view === 'activity'} label="Activity" icon="" onClick={() => setView('activity')} />
          <NavButton active={view === 'room'} label="Room" icon="" onClick={() => setView('room')} />
          <button className="desktop-add" onClick={() => setOverlay('add')}>+ Add expense</button>
        </nav>
        <button className="avatar-button" onClick={() => setOverlay('rooms')} aria-label="Switch room">A<span className="status-dot" /></button>
      </header>
      <main className="main-content">
        {view === 'home' && <Home expenses={expenses} onAdd={() => setOverlay('add')} onPay={() => setOverlay('pay')} onExpense={openExpense} />}
        {view === 'activity' && <Activity expenses={expenses} />}
        {view === 'room' && <Room joinRequest={joinRequest} setJoinRequest={setJoinRequest} onLeave={() => setOverlay('leave')} onToast={showToast} />}
      </main>
      <nav className="bottom-nav" aria-label="Primary navigation">
        <NavButton active={view === 'home'} label="Home" icon="⌂" onClick={() => setView('home')} />
        <button className="add-button" onClick={() => setOverlay('add')} aria-label="Add expense"><span>+</span><small>Add expense</small></button>
        <NavButton active={view === 'activity'} label="Activity" icon="◷" onClick={() => setView('activity')} />
        <NavButton active={view === 'room'} label="Room" icon="⌂" onClick={() => setView('room')} />
      </nav>
      {overlay === 'add' && <AddExpense onClose={() => setOverlay(null)} onSubmit={addExpense} />}
      {overlay === 'expense' && selectedExpense && <ExpenseDetails expense={selectedExpense} onClose={() => setOverlay(null)} onToast={showToast} />}
      {overlay === 'pay' && <PayBack onClose={() => setOverlay(null)} onToast={showToast} />}
      {overlay === 'rooms' && <RoomSwitcher onClose={() => setOverlay(null)} onToast={showToast} />}
      {overlay === 'leave' && <LeaveRoom onClose={() => setOverlay(null)} onToast={showToast} />}
      {toast && <div className="toast" role="status">{toast}<span>✓</span></div>}
    </div>
  )
}

function NavButton({ active, label, icon, onClick }: { active: boolean; label: string; icon: string; onClick: () => void }) {
  return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}><span className="nav-icon">{icon}</span><span>{label}</span></button>
}

function Home({ expenses, onAdd, onPay, onExpense }: { expenses: Expense[]; onAdd: () => void; onPay: () => void; onExpense: (expense: Expense) => void }) {
  return <div className="home-layout">
    <section className="intro-row"><div><p className="eyebrow">Your shared home</p><h1>Green Park Flat</h1><p className="muted">4 roommates <span className="tiny-dot">·</span> Room ID GP7K29</p></div><button className="round-action" onClick={onAdd} aria-label="Add expense">+</button></section>
    <section className="balance-hero"><p className="eyebrow">Your balance</p><div className="balance-number">+₹1,250</div><p className="balance-caption"><span>₹750 to pay</span><i>·</i><span>₹2,000 to receive</span></p></section>
    <section className="money-grid"><MoneySection title="You need to pay" rows={[['Rahul', 500], ['Priya', 250]]} action="Pay back" onAction={onPay} /><MoneySection title="Others need to pay you" rows={[['Aman', 1200], ['Rahul', 800]]} /></section>
    <section className="section-block monthly-section"><SectionTitle title="My monthly status" action="Export PDF" /><div className="status-grid"><StatusItem label="You paid" value="₹6,200" /><StatusItem label="Paid for others" value="₹1,350" /><StatusItem label="Your share" value="₹4,850" /><StatusItem label="Room spent" value="₹18,450" /></div></section>
    <section className="section-block recent-section"><SectionTitle title="Recent expenses" action="See all" /><div className="expense-list">{expenses.map((expense) => <ExpenseRow key={expense.id} expense={expense} onClick={() => onExpense(expense)} />)}</div></section>
  </div>
}

function SectionTitle({ title, action }: { title: string; action?: string }) { return <div className="section-title"><h2>{title}</h2>{action && <button className="text-button">{action}<span>↗</span></button>}</div> }
function MoneySection({ title, rows, action, onAction }: { title: string; rows: [string, number][]; action?: string; onAction?: () => void }) { return <section className="money-section"><div className="section-title"><h2>{title}</h2>{action && <button className="text-button" onClick={onAction}>{action}<span>↗</span></button>}</div>{rows.map(([person, amount]) => <button className="money-row" key={person}><span className="person-initial">{person[0]}</span><span className="person-name">{person}</span><strong>{money(amount)}</strong><span className="chevron">›</span></button>)}</section> }
function StatusItem({ label, value }: { label: string; value: string }) { return <div className="status-item"><span>{label}</span><strong>{value}</strong></div> }
function ExpenseRow({ expense, onClick }: { expense: Expense; onClick: () => void }) { return <button className="expense-row" onClick={onClick}><span className="expense-icon">{expense.title === 'Electricity' ? '↯' : expense.title === 'Milk & eggs' ? '◒' : '✣'}</span><span className="expense-info"><strong>{expense.title}{expense.edited && <em>Edited</em>}</strong><small>Paid by {expense.paidBy} <span>·</span> {expense.date}</small></span><strong className="expense-amount">{money(expense.amount)}</strong><span className="chevron">›</span></button> }

function Activity({ expenses }: { expenses: Expense[] }) { return <><section className="page-heading"><p className="eyebrow">The room, in motion</p><h1>Activity</h1><p className="muted">A quiet record of what happened.</p></section><section className="activity-list"><ActivityItem title="Akshay added Groceries" detail="₹1,840" time="Today · 8:42 PM" /><ActivityItem title="Rahul paid Priya" detail="₹500" time="Yesterday · 7:31 PM" /><ActivityItem title="Priya edited Electricity" detail="Amount updated" time="Sep 28 · 9:14 AM" /><ActivityItem title="Aman joined the room" detail="Green Park Flat" time="Sep 22 · 6:08 PM" />{expenses.length > 3 && <ActivityItem title={`Akshay added ${expenses[0].title}`} detail={money(expenses[0].amount)} time="Just now" />}</section></> }
function ActivityItem({ title, detail, time }: { title: string; detail: string; time: string }) { return <div className="activity-item"><span className="activity-line" /><div><strong>{title}</strong><p>{detail}</p><small>{time}</small></div></div> }

function Room({ joinRequest, setJoinRequest, onLeave, onToast }: { joinRequest: boolean; setJoinRequest: (value: boolean) => void; onLeave: () => void; onToast: (message: string) => void }) { return <><section className="page-heading room-heading"><p className="eyebrow">The details</p><h1>Green Park Flat</h1><div className="room-id"><span>Room ID <strong>GP7K29</strong></span><button className="text-button" onClick={() => onToast('Room ID copied')}>Copy ID</button></div></section><section className="room-section"><SectionTitle title="Roommates" /><Roommate name="Akshay" detail="You" /><Roommate name="Rahul" detail="Needs to pay ₹500" /><Roommate name="Priya" detail="Needs to receive ₹250" /><Roommate name="Aman" detail="Needs to pay ₹1,200" /></section>{joinRequest && <section className="request-block"><div><p className="eyebrow">Join requests</p><strong>Rohit wants to join</strong></div><div className="request-actions"><button onClick={() => { setJoinRequest(false); onToast('Rohit joined the room') }}>Approve</button><button className="quiet-button" onClick={() => setJoinRequest(false)}>Decline</button></div></section>}<section className="former-section"><SectionTitle title="Former roommates" /><div className="former-person"><span><strong>Vikas</strong><small>Left Sep 12</small></span><span><small>Still to receive</small><strong>₹850</strong></span></div></section><button className="leave-button" onClick={onLeave}>Leave room <span>→</span></button></> }
function Roommate({ name, detail }: { name: string; detail: string }) { return <div className="roommate"><span className="person-initial">{name[0]}</span><span><strong>{name}</strong><small>{detail}</small></span><span className="chevron">›</span></div> }

function AddExpense({ onClose, onSubmit }: { onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
  const [amount, setAmount] = useState('')
  const [selectedMembers, setSelectedMembers] = useState(members)
  const splitAmount = Number(amount) && selectedMembers.length ? Number(amount) / selectedMembers.length : 0
  const splitLabel = splitAmount ? `₹${splitAmount.toLocaleString('en-IN', { minimumFractionDigits: splitAmount % 1 ? 2 : 0, maximumFractionDigits: 2 })} each` : 'Add an amount'
  const toggleMember = (member: string) => setSelectedMembers((current) => current.includes(member) ? current.filter((item) => item !== member) : [...current, member])

  return <Modal title="Add an expense" onClose={onClose}><form className="expense-form" onSubmit={onSubmit}><label className="amount-field"><span>Amount</span><div><b>₹</b><input name="amount" inputMode="decimal" placeholder="0" autoFocus required value={amount} onChange={(event) => setAmount(event.target.value)} /></div></label><label>What was it? <span className="form-optional">(optional)</span><input name="title" placeholder="e.g. Groceries" /></label><label>Paid by<button type="button" className="select-field"><span className="person-initial">A</span>Akshay <span>⌄</span></button></label><fieldset className="member-field"><legend>Shared with</legend><div className="member-list">{members.map((member) => { const selected = selectedMembers.includes(member); return <button type="button" key={member} className={`member-option ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={() => toggleMember(member)}><span className="member-check">{selected ? '✓' : '×'}</span>{member}</button> })}</div></fieldset><div className="split-choice"><span>How to split</span><strong>Split equally <small>{splitLabel}</small></strong></div><button className="primary-button" type="submit">Add expense <span>→</span></button></form></Modal>
}
function ExpenseDetails({ expense, onClose, onToast }: { expense: Expense; onClose: () => void; onToast: (message: string) => void }) { return <Modal title="Expense details" onClose={onClose}><div className="detail-hero"><span className="expense-icon">✣</span><h2>{expense.title}</h2><strong>{money(expense.amount)}</strong>{expense.edited && <em>Edited</em>}</div><div className="detail-list"><Detail label="Paid by" value={expense.paidBy} /><Detail label="Shared with" value="Akshay · Rahul · Priya · Aman" /><Detail label="How it was split" value="Split equally" /><Detail label="Each person's share" value={money(Math.round(expense.amount / 4))} /><Detail label="Date" value={expense.date} /></div><div className="detail-actions"><button onClick={() => onToast('Editing is ready for this prototype')}>Edit</button><button onClick={() => onToast('History opened')}>History</button></div></Modal> }
function Detail({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div> }
function PayBack({ onClose, onToast }: { onClose: () => void; onToast: (message: string) => void }) { const [amount, setAmount] = useState('500'); const remaining = Math.max(0, 750 - (Number(amount) || 0)); return <Modal title="Pay Rahul" onClose={onClose}><div className="pay-intro"><span className="person-initial">R</span><p>You need to pay Rahul <strong>₹750</strong></p></div><label className="amount-field"><span>Amount paid</span><div><b>₹</b><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></div></label><div className="remaining"><span>Remaining after payment</span><strong>{money(remaining)}</strong></div><button className="primary-button" onClick={() => { onClose(); onToast(`You paid Rahul ${money(Number(amount) || 0)}`) }}>Record payment <span>→</span></button></Modal> }
function RoomSwitcher({ onClose, onToast }: { onClose: () => void; onToast: (message: string) => void }) { return <Modal title="Your rooms" onClose={onClose}><div className="room-switcher">{['Green Park Flat', 'Hostel Room', 'Old Flat'].map((room, index) => <button key={room} className={index === 0 ? 'selected-room' : ''} onClick={() => { onClose(); onToast(index === 0 ? 'Already in Green Park Flat' : `${room} is a preview`) }}><span>{room}</span>{index === 0 && <strong>✓</strong>}</button>)}</div><button className="secondary-button" onClick={() => onToast('Room creation is ready for the next step')}>+ Add room</button></Modal> }
function LeaveRoom({ onClose, onToast }: { onClose: () => void; onToast: (message: string) => void }) { return <Modal title="Leave room" onClose={onClose}><div className="leave-warning"><span>!</span><p>You still need to pay <strong>₹750</strong>.<br />Leaving does not erase financial history.</p></div><button className="leave-confirm" onClick={() => { onClose(); onToast('Leave room simulated') }}>Leave Green Park Flat</button><button className="secondary-button" onClick={onClose}>Stay in room</button></Modal> }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal-sheet" role="dialog" aria-modal="true" aria-label={title}><div className="modal-handle" /><div className="modal-header"><h2>{title}</h2><button onClick={onClose} aria-label="Close">×</button></div>{children}</section></div> }

export default App
