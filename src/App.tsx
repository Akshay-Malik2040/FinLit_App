import { useEffect, useState } from 'react'
import './App.css'
import { apiIsConfigured, ApiError, createExpense, createRoom, decideJoinRequest, ensureSession, getActivity, getBalances, getCurrentUser, getExpenseHistory, getRoom, getSummary, joinRoom, leaveRoom, listExpenses, listJoinRequests, listRooms, logout, recordPayment, updateExpense, type ApiActivity, type ApiSummary, type ExpenseDraft } from './services/api'

type View = 'home' | 'activity' | 'room'
type Overlay = 'add' | 'expense' | 'edit' | 'history' | 'pay' | 'rooms' | 'leave' | null

type Expense = {
  id: number
  apiId?: string
  title: string
  amount: number
  paidBy: string
  date: string
  note: string
  edited?: boolean
}
type RoomMember = { id: string; name: string; role: 'admin' | 'member'; status: 'active' | 'left' }
type PaymentRow = [string, number]
type JoinRequest = { id: string; name: string }

const initialExpenses: Expense[] = [
  { id: 1, title: 'Groceries', amount: 1840, paidBy: 'Akshay', date: 'Today', note: 'Weekly grocery run' },
  { id: 2, title: 'Electricity', amount: 2430, paidBy: 'Rahul', date: 'Yesterday', note: 'September electricity bill' },
  { id: 3, title: 'Milk & eggs', amount: 260, paidBy: 'Priya', date: 'Sep 28', note: 'Morning essentials' },
]
const mockMembers = ['Akshay', 'Rahul', 'Priya', 'Aman']

const money = (amount: number) => `₹${amount.toLocaleString('en-IN')}`
const toUiExpense = (expense: { _id: string; description: string; amountPaise: number; expenseDate: string; payerId: { displayName: string } | string }): Expense => ({
  id: Number.parseInt(expense._id.slice(-8), 16),
  apiId: expense._id,
  title: expense.description,
  amount: expense.amountPaise / 100,
  paidBy: typeof expense.payerId === 'string' ? 'Roommate' : expense.payerId.displayName,
  date: new Date(expense.expenseDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
  note: '',
})

function App() {
  const [view, setView] = useState<View>('home')
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [expenses, setExpenses] = useState(initialExpenses)
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null)
  const [expenseHistory, setExpenseHistory] = useState<ApiActivity[]>([])
  const [toast, setToast] = useState('')
  const [joinRequest, setJoinRequest] = useState(true)
  const [roomContext, setRoomContext] = useState({ id: 'GP7K29', name: 'Green Park Flat' })
  const [roomMembers, setRoomMembers] = useState<RoomMember[]>(mockMembers.map((name, index) => ({ id: `mock-${index}`, name, role: index === 0 ? 'admin' : 'member', status: 'active' })))
  const [currentUserId, setCurrentUserId] = useState('mock-0')
  const [needToPay, setNeedToPay] = useState<PaymentRow[]>([['Rahul', 500], ['Priya', 250]])
  const [needToReceive, setNeedToReceive] = useState<PaymentRow[]>([['Aman', 1200], ['Rahul', 800]])
  const [paymentTarget, setPaymentTarget] = useState({ id: '', name: 'Rahul', amount: 750 })
  const [activity, setActivity] = useState<ApiActivity[]>([])
  const [summary, setSummary] = useState<ApiSummary>({ month: '', roomSpentPaise: 1845000, youPaidPaise: 620000, yourSharePaise: 485000, paidForOthersPaise: 135000 })
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([])
  const [authStatus, setAuthStatus] = useState<'checking' | 'loggedOut' | 'ready'>(apiIsConfigured ? 'checking' : 'loggedOut')
  const [loginError, setLoginError] = useState('')

  useEffect(() => {
    if (!apiIsConfigured) return
    void getCurrentUser().then((session) => { setCurrentUserId(session.user.id); setAuthStatus('ready') }).catch(() => setAuthStatus('loggedOut'))
  }, [])

  useEffect(() => {
    if (!apiIsConfigured || authStatus !== 'ready') return
    void (async () => {
      try {
        const session = await ensureSession('Akshay')
        setCurrentUserId(session.user.id)
        const rooms = await listRooms()
        let activeRoom = rooms.rooms.find((item) => item.status === 'active')
        if (!activeRoom) {
          const created = await createRoom('Green Park Flat')
          activeRoom = { roomId: created.room, role: 'admin', status: 'active' }
        }
        const roomId = activeRoom.roomId.publicId
        setRoomContext({ id: roomId, name: activeRoom.roomId.name })
        const [room, result, balance, loadedSummary, loadedActivity] = await Promise.all([getRoom(roomId), listExpenses(roomId), getBalances(roomId), getSummary(roomId), getActivity(roomId)])
        setSummary(loadedSummary)
        setActivity(loadedActivity.events)
        const loadedMembers = room.members.map((member) => ({ id: member.userId._id, name: member.userId.displayName, role: member.role, status: member.status }))
        setRoomMembers(loadedMembers)
        if (loadedMembers.find((member) => member.id === session.user.id)?.role === 'admin') {
          try { const requests = await listJoinRequests(roomId); setJoinRequests(requests.requests.map((request) => ({ id: request._id, name: request.userId.displayName }))) } catch { setJoinRequests([]) }
        }
        const memberName = new Map(loadedMembers.map((member) => [member.id, member.name]))
        const outgoing = balance.suggestions.filter((suggestion) => suggestion.fromUserId === session.user.id)
        setNeedToPay(outgoing.map((suggestion) => [memberName.get(suggestion.toUserId) ?? 'Roommate', suggestion.amountPaise / 100]))
        if (outgoing[0]) setPaymentTarget({ id: outgoing[0].toUserId, name: memberName.get(outgoing[0].toUserId) ?? 'Roommate', amount: outgoing[0].amountPaise / 100 })
        setNeedToReceive(balance.suggestions.filter((suggestion) => suggestion.toUserId === session.user.id).map((suggestion) => [memberName.get(suggestion.fromUserId) ?? 'Roommate', suggestion.amountPaise / 100]))
        setExpenses(result.expenses.filter((expense) => !expense.voidedAt).map(toUiExpense))
      } catch (error) {
        if (error instanceof ApiError && error.code === 'ROOM_ACCESS_DENIED') {
          await logout().catch(() => undefined)
          setLoginError('Your previous room session is no longer active. Please sign in again.')
          setAuthStatus('loggedOut')
        } else showToast('We could not load your room.')
      }
    })()
  }, [authStatus])

  function showToast(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(''), 2600)
  }

  const login = async (displayName: string) => {
    setLoginError('')
    if (!apiIsConfigured) {
      setCurrentUserId('mock-0')
      setAuthStatus('ready')
      return
    }
    try {
      const session = await ensureSession(displayName)
      setCurrentUserId(session.user.id)
      setAuthStatus('ready')
    } catch { setLoginError('We could not start your session. Check that the API is running.') }
  }

  if (authStatus !== 'ready') return <LoginPage apiConfigured={apiIsConfigured} error={loginError} onSubmit={login} />

  const addExpense = async (draft: ExpenseDraft) => {
    const title = draft.description || 'Shared expense'
    if (apiIsConfigured && !currentUserId.startsWith('mock-')) {
      try {
        const result = await createExpense(roomContext.id, draft)
        setExpenses((current) => [toUiExpense(result.expense), ...current])
        await refreshRoomData()
      } catch { showToast('We could not add this expense.') ; return }
    } else {
      setExpenses((current) => [{ id: Date.now(), title, amount: draft.amountPaise / 100, paidBy: 'Akshay', date: 'Just now', note: '', edited: false }, ...current])
    }
    setOverlay(null)
    showToast(`${title} added to the room`)
  }

  const openExpense = (expense: Expense) => {
    setSelectedExpense(expense)
    setOverlay('expense')
  }

  const refreshRoomData = async () => {
    if (!apiIsConfigured || currentUserId.startsWith('mock-')) return
    const [result, balance, loadedSummary, loadedActivity] = await Promise.all([listExpenses(roomContext.id), getBalances(roomContext.id), getSummary(roomContext.id), getActivity(roomContext.id)])
    const memberName = new Map(roomMembers.map((member) => [member.id, member.name]))
    const outgoing = balance.suggestions.filter((suggestion) => suggestion.fromUserId === currentUserId)
    setNeedToPay(outgoing.map((suggestion) => [memberName.get(suggestion.toUserId) ?? 'Roommate', suggestion.amountPaise / 100]))
    if (outgoing[0]) setPaymentTarget({ id: outgoing[0].toUserId, name: memberName.get(outgoing[0].toUserId) ?? 'Roommate', amount: outgoing[0].amountPaise / 100 })
    setNeedToReceive(balance.suggestions.filter((suggestion) => suggestion.toUserId === currentUserId).map((suggestion) => [memberName.get(suggestion.fromUserId) ?? 'Roommate', suggestion.amountPaise / 100]))
    setExpenses(result.expenses.filter((expense) => !expense.voidedAt).map(toUiExpense))
    setSummary(loadedSummary)
    setActivity(loadedActivity.events)
  }

  const openHistory = async () => {
    if (!selectedExpense?.apiId) { setExpenseHistory([]); setOverlay('history'); return }
    try { const result = await getExpenseHistory(selectedExpense.apiId); setExpenseHistory(result.history); setOverlay('history') }
    catch { showToast('We could not load this expense history.') }
  }

  const editExpense = async (draft: { description: string; amountPaise: number }) => {
    if (!selectedExpense) return
    if (apiIsConfigured && selectedExpense.apiId) {
      try { await updateExpense(selectedExpense.apiId, draft); await refreshRoomData() }
      catch { showToast("We couldn't update this expense."); return }
    } else setExpenses((current) => current.map((item) => item.id === selectedExpense.id ? { ...item, title: draft.description || 'Shared expense', amount: draft.amountPaise / 100, edited: true } : item))
    setOverlay('expense'); showToast('Expense updated')
  }

  const decideRequest = async (requestId: string, action: 'approve' | 'reject') => {
    try { await decideJoinRequest(roomContext.id, requestId, action); setJoinRequests((current) => current.filter((request) => request.id !== requestId)); await refreshRoomData(); showToast(action === 'approve' ? 'Roommate approved' : 'Join request declined') }
    catch { showToast("We couldn't update that join request.") }
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
        {view === 'home' && <Home room={roomContext} memberCount={roomMembers.length} expenses={expenses} needToPay={needToPay} needToReceive={needToReceive} summary={summary} onAdd={() => setOverlay('add')} onPay={() => setOverlay('pay')} onExpense={openExpense} onExport={() => window.open(`/api/rooms/${roomContext.id}/summary.pdf`, '_blank')} />}
        {view === 'activity' && <Activity events={activity} />}
        {view === 'room' && <Room room={roomContext} members={roomMembers} requests={joinRequests} joinRequest={joinRequest} setJoinRequest={setJoinRequest} onRequest={decideRequest} onLeave={() => setOverlay('leave')} onToast={showToast} />}
      </main>
      <nav className="bottom-nav" aria-label="Primary navigation">
        <NavButton active={view === 'home'} label="Home" icon="⌂" onClick={() => setView('home')} />
        <button className="add-button" onClick={() => setOverlay('add')} aria-label="Add expense"><span>+</span><small>Add expense</small></button>
        <NavButton active={view === 'activity'} label="Activity" icon="◷" onClick={() => setView('activity')} />
        <NavButton active={view === 'room'} label="Room" icon="⌂" onClick={() => setView('room')} />
      </nav>
      {overlay === 'add' && <AddExpense availableMembers={roomMembers} currentUserId={currentUserId} onClose={() => setOverlay(null)} onSubmit={addExpense} />}
      {overlay === 'expense' && selectedExpense && <ExpenseDetails expense={selectedExpense} onClose={() => setOverlay(null)} onEdit={() => setOverlay('edit')} onHistory={() => void openHistory()} />}
      {overlay === 'edit' && selectedExpense && <EditExpense expense={selectedExpense} onClose={() => setOverlay('expense')} onSubmit={editExpense} />}
      {overlay === 'history' && <HistoryModal history={expenseHistory} onClose={() => setOverlay('expense')} />}
      {overlay === 'pay' && <PayBack roomId={roomContext.id} target={paymentTarget} onClose={() => setOverlay(null)} onToast={showToast} onRefresh={refreshRoomData} />}
      {overlay === 'rooms' && <RoomSwitcher onClose={() => setOverlay(null)} onToast={showToast} />}
      {overlay === 'leave' && <LeaveRoom roomId={roomContext.id} onClose={() => setOverlay(null)} onToast={showToast} />}
      {toast && <div className="toast" role="status">{toast}<span>✓</span></div>}
    </div>
  )
}

function LoginPage({ apiConfigured, error, onSubmit }: { apiConfigured: boolean; error: string; onSubmit: (displayName: string) => Promise<void> }) {
  const [displayName, setDisplayName] = useState('')
  const submit = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); void onSubmit(displayName.trim()) }
  return <main className="login-page"><div className="login-mark">ff</div><p className="eyebrow">Your room's money</p><h1>Welcome to<br /><em>flatmate finance</em></h1><p className="login-copy">A calm place to keep track of shared expenses with your flatmates.</p><form className="login-form" onSubmit={submit}><label htmlFor="display-name">What should we call you?</label><input id="display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Your name" autoComplete="name" autoFocus required maxLength={80} /><button className="primary-button" type="submit">Continue <span>→</span></button></form>{error && <p className="login-error" role="alert">{error}</p>}<small className="login-note">{apiConfigured ? 'Your session is private and stored securely.' : 'Preview mode · connect the API for live room data.'}</small></main>
}

function NavButton({ active, label, icon, onClick }: { active: boolean; label: string; icon: string; onClick: () => void }) {
  return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}><span className="nav-icon">{icon}</span><span>{label}</span></button>
}

function Home({ room, memberCount, expenses, needToPay, needToReceive, summary, onAdd, onPay, onExpense, onExport }: { room: { id: string; name: string }; memberCount: number; expenses: Expense[]; needToPay: PaymentRow[]; needToReceive: PaymentRow[]; summary: ApiSummary; onAdd: () => void; onPay: () => void; onExpense: (expense: Expense) => void; onExport: () => void }) {
  const toPay = needToPay.reduce((total, [, amount]) => total + amount, 0)
  const toReceive = needToReceive.reduce((total, [, amount]) => total + amount, 0)
  const balance = toReceive - toPay
  const balanceLabel = `${balance >= 0 ? '+' : '-'}${money(Math.abs(balance))}`
  return <div className="home-layout">
    <section className="intro-row"><div><p className="eyebrow">Your shared home</p><h1>{room.name}</h1><p className="muted">{memberCount} roommates <span className="tiny-dot">·</span> Room ID {room.id}</p></div><button className="round-action" onClick={onAdd} aria-label="Add expense">+</button></section>
    <section className="balance-hero"><p className="eyebrow">Your balance</p><div className="balance-number">{balanceLabel}</div><p className="balance-caption"><span>{money(toPay)} to pay</span><i>·</i><span>{money(toReceive)} to receive</span></p></section>
    <section className="money-grid"><MoneySection title="You need to pay" rows={needToPay} action="Pay back" onAction={onPay} /><MoneySection title="Others need to pay you" rows={needToReceive} /></section>
    <section className="section-block monthly-section"><SectionTitle title="My monthly status" action="Export PDF" onAction={onExport} /><div className="status-grid"><StatusItem label="You paid" value={money(summary.youPaidPaise / 100)} /><StatusItem label="Paid for others" value={money(summary.paidForOthersPaise / 100)} /><StatusItem label="Your share" value={money(summary.yourSharePaise / 100)} /><StatusItem label="Room spent" value={money(summary.roomSpentPaise / 100)} /></div></section>
    <section className="section-block recent-section"><SectionTitle title="Recent expenses" action="See all" /><div className="expense-list">{expenses.map((expense) => <ExpenseRow key={expense.id} expense={expense} onClick={() => onExpense(expense)} />)}</div></section>
  </div>
}

function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) { return <div className="section-title"><h2>{title}</h2>{action && <button className="text-button" onClick={onAction}>{action}<span>↗</span></button>}</div> }
function MoneySection({ title, rows, action, onAction }: { title: string; rows: [string, number][]; action?: string; onAction?: () => void }) { return <section className="money-section"><div className="section-title"><h2>{title}</h2>{action && <button className="text-button" onClick={onAction}>{action}<span>↗</span></button>}</div>{rows.map(([person, amount]) => <button className="money-row" key={person}><span className="person-initial">{person[0]}</span><span className="person-name">{person}</span><strong>{money(amount)}</strong><span className="chevron">›</span></button>)}</section> }
function StatusItem({ label, value }: { label: string; value: string }) { return <div className="status-item"><span>{label}</span><strong>{value}</strong></div> }
function ExpenseRow({ expense, onClick }: { expense: Expense; onClick: () => void }) { return <button className="expense-row" onClick={onClick}><span className="expense-icon">{expense.title === 'Electricity' ? '↯' : expense.title === 'Milk & eggs' ? '◒' : '✣'}</span><span className="expense-info"><strong>{expense.title}{expense.edited && <em>Edited</em>}</strong><small>Paid by {expense.paidBy} <span>·</span> {expense.date}</small></span><strong className="expense-amount">{money(expense.amount)}</strong><span className="chevron">›</span></button> }

function Activity({ events }: { events: ApiActivity[] }) { return <><section className="page-heading"><p className="eyebrow">The room, in motion</p><h1>Activity</h1><p className="muted">A quiet record of what happened.</p></section><section className="activity-list">{events.length ? events.map((event) => <ActivityItem key={event._id} title={activityTitle(event.action, event.actorId?.displayName)} detail={event.action.includes('created') ? 'Expense added' : event.action.includes('payment') ? 'Payment recorded' : 'Room record updated'} time={new Date(event.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} />) : <p className="muted empty-copy">No activity yet. Changes in your room will appear here.</p>}</section></> }
function activityTitle(action: string, actor = 'A roommate') { const words = action.replace('.', ' ').split(' '); return `${actor} ${words.slice(1).join(' ')}` }
function ActivityItem({ title, detail, time }: { title: string; detail: string; time: string }) { return <div className="activity-item"><span className="activity-line" /><div><strong>{title}</strong><p>{detail}</p><small>{time}</small></div></div> }

function Room({ room, members, requests, joinRequest, setJoinRequest, onRequest, onLeave, onToast }: { room: { id: string; name: string }; members: RoomMember[]; requests: JoinRequest[]; joinRequest: boolean; setJoinRequest: (value: boolean) => void; onRequest: (requestId: string, action: 'approve' | 'reject') => Promise<void>; onLeave: () => void; onToast: (message: string) => void }) { return <><section className="page-heading room-heading"><p className="eyebrow">The details</p><h1>{room.name}</h1><div className="room-id"><span>Room ID <strong>{room.id}</strong></span><button className="text-button" onClick={() => { void navigator.clipboard?.writeText(room.id); onToast('Room ID copied') }}>Copy ID</button></div></section><section className="room-section"><SectionTitle title="Roommates" />{members.map((member) => <Roommate key={member.id} name={member.name} detail={member.status === 'left' ? 'Former roommate' : member.id === 'mock-0' ? 'You' : member.role === 'admin' ? 'Room admin' : 'Active roommate'} />)}</section>{(requests.length > 0 || (joinRequest && !apiIsConfigured)) && <section className="request-block"><div><p className="eyebrow">Join requests</p>{requests.length ? requests.map((request) => <strong key={request.id} className="request-name">{request.name} wants to join</strong>) : <strong>Join requests will appear here</strong>}</div><div className="request-actions">{requests.length ? requests.map((request) => <span key={request.id}><button onClick={() => void onRequest(request.id, 'approve')}>Approve</button><button className="quiet-button" onClick={() => void onRequest(request.id, 'reject')}>Decline</button></span>) : <button onClick={() => { setJoinRequest(false); onToast('Requests refreshed') }}>Refresh</button>}</div></section>}<section className="former-section"><SectionTitle title="Former roommates" /><div className="former-person"><span><strong>{members.find((member) => member.status === 'left')?.name ?? 'None yet'}</strong><small>{members.some((member) => member.status === 'left') ? 'Historical record preserved' : 'Former roommates stay visible here'}</small></span></div></section><button className="leave-button" onClick={onLeave}>Leave room <span>→</span></button></> }
function Roommate({ name, detail }: { name: string; detail: string }) { return <div className="roommate"><span className="person-initial">{name[0]}</span><span><strong>{name}</strong><small>{detail}</small></span><span className="chevron">›</span></div> }

function AddExpense({ availableMembers, currentUserId, onClose, onSubmit }: { availableMembers: RoomMember[]; currentUserId: string; onClose: () => void; onSubmit: (draft: ExpenseDraft) => Promise<void> }) {
  const [amount, setAmount] = useState('')
  const [selectedMembers, setSelectedMembers] = useState(availableMembers)
  const splitAmount = Number(amount) && selectedMembers.length ? Number(amount) / selectedMembers.length : 0
  const splitLabel = splitAmount ? `₹${splitAmount.toLocaleString('en-IN', { minimumFractionDigits: splitAmount % 1 ? 2 : 0, maximumFractionDigits: 2 })} each` : 'Add an amount'
  const toggleMember = (member: RoomMember) => setSelectedMembers((current) => current.some((item) => item.id === member.id) ? current.filter((item) => item.id !== member.id) : [...current, member])
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    void onSubmit({ description: String(form.get('title') || '').trim() || undefined, amountPaise: Math.round(Number(amount) * 100), payerId: currentUserId, participantIds: selectedMembers.map((member) => member.id) })
  }

  return <Modal title="Add an expense" onClose={onClose}><form className="expense-form" onSubmit={submit}><label className="amount-field"><span>Amount</span><div><b>₹</b><input name="amount" inputMode="decimal" placeholder="0" autoFocus required value={amount} onChange={(event) => setAmount(event.target.value)} /></div></label><label>What was it? <span className="form-optional">(optional)</span><input name="title" placeholder="e.g. Groceries" /></label><label>Paid by<button type="button" className="select-field"><span className="person-initial">A</span>{availableMembers.find((member) => member.id === currentUserId)?.name ?? 'You'} <span>⌄</span></button></label><fieldset className="member-field"><legend>Shared with</legend><div className="member-list">{availableMembers.map((member) => { const selected = selectedMembers.some((item) => item.id === member.id); return <button type="button" key={member.id} className={`member-option ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={() => toggleMember(member)}><span className="member-check">{selected ? '✓' : '×'}</span>{member.name}</button> })}</div></fieldset><div className="split-choice"><span>How to split</span><strong>Split equally <small>{splitLabel}</small></strong></div><button className="primary-button" type="submit">Add expense <span>→</span></button></form></Modal>
}
function ExpenseDetails({ expense, onClose, onEdit, onHistory }: { expense: Expense; onClose: () => void; onEdit: () => void; onHistory: () => void }) { return <Modal title="Expense details" onClose={onClose}><div className="detail-hero"><span className="expense-icon">✣</span><h2>{expense.title}</h2><strong>{money(expense.amount)}</strong>{expense.edited && <em>Edited</em>}</div><div className="detail-list"><Detail label="Paid by" value={expense.paidBy} /><Detail label="Shared with" value="Room members" /><Detail label="How it was split" value="Split equally" /><Detail label="Each person's share" value={money(Math.round(expense.amount / 4))} /><Detail label="Date" value={expense.date} /></div><div className="detail-actions"><button onClick={onEdit}>Edit</button><button onClick={onHistory}>History</button></div></Modal> }
function Detail({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div> }
function EditExpense({ expense, onClose, onSubmit }: { expense: Expense; onClose: () => void; onSubmit: (draft: { description: string; amountPaise: number }) => Promise<void> }) { const [title, setTitle] = useState(expense.title); const [amount, setAmount] = useState(String(expense.amount)); return <Modal title="Edit expense" onClose={onClose}><form className="expense-form" onSubmit={(event) => { event.preventDefault(); void onSubmit({ description: title.trim(), amountPaise: Math.round(Number(amount) * 100) }) }}><label>What was it?<input value={title} onChange={(event) => setTitle(event.target.value)} required /></label><label className="amount-field"><span>Amount</span><div><b>₹</b><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required /></div></label><button className="primary-button" type="submit">Save changes <span>→</span></button></form></Modal> }
function HistoryModal({ history, onClose }: { history: ApiActivity[]; onClose: () => void }) { return <Modal title="Change history" onClose={onClose}><div className="history-list">{history.length ? history.map((event) => <div className="history-item" key={event._id}><strong>{event.actorId?.displayName ?? 'A roommate'} {event.action.replace('.', ' ')}</strong><small>{new Date(event.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</small></div>) : <p className="muted">No changes recorded yet.</p>}</div></Modal> }
function PayBack({ roomId, target, onClose, onToast, onRefresh }: { roomId: string; target: { id: string; name: string; amount: number }; onClose: () => void; onToast: (message: string) => void; onRefresh: () => Promise<void> }) { const [amount, setAmount] = useState(String(Math.min(500, target.amount))); const remaining = Math.max(0, target.amount - (Number(amount) || 0)); const submit = async () => { const amountPaise = Math.round((Number(amount) || 0) * 100); if (apiIsConfigured && target.id) { try { await recordPayment(roomId, target.id, amountPaise); await onRefresh() } catch { onToast("We couldn't record the payment."); return } } onClose(); onToast(`You paid ${target.name} ${money(Number(amount) || 0)}`) }; return <Modal title={`Pay ${target.name}`} onClose={onClose}><div className="pay-intro"><span className="person-initial">{target.name[0]}</span><p>You need to pay {target.name} <strong>{money(target.amount)}</strong></p></div><label className="amount-field"><span>Amount paid</span><div><b>₹</b><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></div></label><div className="remaining"><span>Remaining after payment</span><strong>{money(remaining)}</strong></div><button className="primary-button" onClick={() => void submit()}>Record payment <span>→</span></button></Modal> }
function RoomSwitcher({ onClose, onToast }: { onClose: () => void; onToast: (message: string) => void }) { const [roomName, setRoomName] = useState(''); const [roomId, setRoomId] = useState(''); const submitCreate = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!apiIsConfigured) { onClose(); onToast('Room creation is available in live mode'); return } try { await createRoom(roomName.trim()); onClose(); window.location.reload() } catch { onToast("We couldn't create that room.") } }; const submitJoin = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!apiIsConfigured) { onClose(); onToast('Join requests are available in live mode'); return } try { await joinRoom(roomId.trim()); onClose(); onToast('Join request sent') } catch { onToast("We couldn't find that room.") } }; return <Modal title="Your rooms" onClose={onClose}><div className="room-switcher"><button className="selected-room"><span>Current room</span><strong>✓</strong></button></div><form className="room-form" onSubmit={submitCreate}><label>New room<input value={roomName} onChange={(event) => setRoomName(event.target.value)} placeholder="e.g. Green Park Flat" required /></label><button className="secondary-button" type="submit">+ Create room</button></form><form className="room-form" onSubmit={submitJoin}><label>Join with Room ID<input value={roomId} onChange={(event) => setRoomId(event.target.value.toUpperCase())} placeholder="e.g. GP7K29" required /></label><button className="secondary-button" type="submit">Request to join</button></form></Modal> }
function LeaveRoom({ roomId, onClose, onToast }: { roomId: string; onClose: () => void; onToast: (message: string) => void }) { const submit = async () => { if (apiIsConfigured) { try { await leaveRoom(roomId) } catch { onToast("We couldn't leave the room."); return } } onClose(); onToast('You left the room') }; return <Modal title="Leave room" onClose={onClose}><div className="leave-warning"><span>!</span><p>You still need to pay <strong>₹750</strong>.<br />Leaving does not erase financial history.</p></div><button className="leave-confirm" onClick={() => void submit()}>Leave Green Park Flat</button><button className="secondary-button" onClick={onClose}>Stay in room</button></Modal> }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal-sheet" role="dialog" aria-modal="true" aria-label={title}><div className="modal-handle" /><div className="modal-header"><h2>{title}</h2><button onClick={onClose} aria-label="Close">×</button></div>{children}</section></div> }

export default App
