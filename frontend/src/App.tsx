import { useEffect, useState, useTransition } from 'react'
import './App.css'
import {
  apiIsConfigured,
  createExpense,
  createRoom,
  createSession,
  decideJoinRequest,
  getActivity,
  getBalances,
  getCurrentUser,
  getExpenseHistory,
  getRoom,
  getSummary,
  joinRoom,
  leaveRoom,
  listExpenses,
  listJoinRequests,
  listRooms,
  logout,
  recordPayment,
  updateExpense,
  voidExpense,
  type ApiActivity,
  type ApiExpense,
  type ApiRoomMembership,
  type ApiSummary,
  type ExpenseDraft,
} from './services/api'

type View = 'home' | 'activity' | 'room'
type Overlay = 'add' | 'expense' | 'edit' | 'history' | 'pay' | 'rooms' | 'leave' | 'create-room' | 'join-room' | null

type Expense = {
  id: string
  apiId: string
  title: string
  amount: number
  paidBy: string
  payerId: string
  participantCount: number
  date: string
  rawDate: string
  note: string
  edited?: boolean
}

type RoomMember = {
  id: string
  name: string
  role: 'admin' | 'member'
  status: 'active' | 'left'
}

type PaymentRow = {
  id: string
  name: string
  amount: number
}

type JoinRequest = {
  id: string
  name: string
}

type CurrentUser = {
  id: string
  displayName: string
}

const money = (amount: number) => `₹${Math.round(amount).toLocaleString('en-IN')}`

const toUiExpense = (expense: ApiExpense): Expense => {
  const payerName = typeof expense.payerId === 'object' && expense.payerId !== null
    ? expense.payerId.displayName
    : 'Roommate'
  const payerId = typeof expense.payerId === 'object' && expense.payerId !== null
    ? expense.payerId._id
    : String(expense.payerId)
  const participantCount = expense.participants?.length || (expense.allocations?.length ?? 1)

  return {
    id: expense._id,
    apiId: expense._id,
    title: expense.description,
    amount: expense.amountPaise / 100,
    paidBy: payerName,
    payerId,
    participantCount: Math.max(1, participantCount),
    date: new Date(expense.expenseDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    rawDate: expense.expenseDate,
    note: '',
    edited: Boolean(expense.allocations && expense.allocations.length > 0 && expense.splitMethod !== 'equal'),
  }
}

function App() {
  const [view, setView] = useState<View>('home')
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [authStatus, setAuthStatus] = useState<'checking' | 'loggedOut' | 'ready'>('checking')
  const [loginError, setLoginError] = useState('')
  const [toast, setToast] = useState('')
  const [isLoadingRoom, setIsLoadingRoom] = useState(false)
  const [, startTransition] = useTransition()

  // Room state (loaded dynamically from API)
  const [userRooms, setUserRooms] = useState<ApiRoomMembership[]>([])
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null)
  const [roomContext, setRoomContext] = useState<{ id: string; name: string } | null>(null)
  const [roomMembers, setRoomMembers] = useState<RoomMember[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null)
  const [expenseHistory, setExpenseHistory] = useState<ApiActivity[]>([])
  const [needToPay, setNeedToPay] = useState<PaymentRow[]>([])
  const [needToReceive, setNeedToReceive] = useState<PaymentRow[]>([])
  const [paymentTarget, setPaymentTarget] = useState<PaymentRow | null>(null)
  const [activity, setActivity] = useState<ApiActivity[]>([])
  const [summary, setSummary] = useState<ApiSummary>({
    month: '',
    roomSpentPaise: 0,
    youPaidPaise: 0,
    yourSharePaise: 0,
    paidForOthersPaise: 0,
  })
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([])

  function showToast(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(''), 2800)
  }

  // 1. Initial auth check
  useEffect(() => {
    let isMounted = true
    getCurrentUser()
      .then((session) => {
        if (isMounted) {
          setCurrentUser(session.user)
          setAuthStatus('ready')
        }
      })
      .catch(() => {
        if (isMounted) {
          setAuthStatus('loggedOut')
        }
      })
    return () => {
      isMounted = false
    }
  }, [])

  // 2. Load user's rooms once authenticated
  useEffect(() => {
    if (authStatus !== 'ready' || !currentUser) return
    let isMounted = true

    const loadRooms = async () => {
      try {
        const result = await listRooms()
        if (!isMounted) return
        setUserRooms(result.rooms)

        const activeRooms = result.rooms.filter((r) => r.status === 'active')
        if (activeRooms.length > 0) {
          setActiveRoomId((prev) => {
            if (prev && activeRooms.some((r) => r.roomId.publicId === prev)) return prev
            return activeRooms[0].roomId.publicId
          })
        } else {
          setActiveRoomId(null)
          setRoomContext(null)
        }
      } catch {
        if (isMounted) showToast('Could not load your rooms list.')
      }
    }

    void loadRooms()
    return () => {
      isMounted = false
    }
  }, [authStatus, currentUser])

  // 3. Load active room details whenever activeRoomId changes
  useEffect(() => {
    if (!activeRoomId || !currentUser) return
    let isMounted = true

    const fetchAllRoomData = async () => {
      setIsLoadingRoom(true)
      try {
        const [roomData, expenseData, balanceData, summaryData, activityData] = await Promise.all([
          getRoom(activeRoomId),
          listExpenses(activeRoomId),
          getBalances(activeRoomId),
          getSummary(activeRoomId),
          getActivity(activeRoomId),
        ])

        if (!isMounted) return
        setRoomContext({ id: roomData.room.publicId, name: roomData.room.name })

        const loadedMembers: RoomMember[] = roomData.members.map((m) => ({
          id: m.userId._id,
          name: m.userId.displayName,
          role: m.role,
          status: m.status,
        }))
        setRoomMembers(loadedMembers)

        // Admin join requests
        const currentMember = loadedMembers.find((m) => m.id === currentUser.id)
        if (currentMember?.role === 'admin') {
          try {
            const reqs = await listJoinRequests(activeRoomId)
            if (isMounted) {
              setJoinRequests(reqs.requests.map((r) => ({ id: r._id, name: r.userId.displayName })))
            }
          } catch {
            if (isMounted) setJoinRequests([])
          }
        } else {
          setJoinRequests([])
        }

        // Member names map
        const memberNameMap = new Map(loadedMembers.map((m) => [m.id, m.name]))

        // Balances & Suggestions
        const outgoing = balanceData.suggestions.filter((s) => s.fromUserId === currentUser.id)
        const incoming = balanceData.suggestions.filter((s) => s.toUserId === currentUser.id)

        const mappedNeedToPay: PaymentRow[] = outgoing.map((s) => ({
          id: s.toUserId,
          name: memberNameMap.get(s.toUserId) ?? 'Roommate',
          amount: s.amountPaise / 100,
        }))

        const mappedNeedToReceive: PaymentRow[] = incoming.map((s) => ({
          id: s.fromUserId,
          name: memberNameMap.get(s.fromUserId) ?? 'Roommate',
          amount: s.amountPaise / 100,
        }))

        setNeedToPay(mappedNeedToPay)
        setNeedToReceive(mappedNeedToReceive)

        if (mappedNeedToPay.length > 0) {
          setPaymentTarget(mappedNeedToPay[0])
        } else {
          setPaymentTarget(null)
        }

        // Expenses (exclude voided)
        const validExpenses = expenseData.expenses
          .filter((e) => !e.voidedAt)
          .map(toUiExpense)
        setExpenses(validExpenses)

        setSummary(summaryData)
        setActivity(activityData.events)
      } catch {
        if (isMounted) showToast('Failed to load room details.')
      } finally {
        if (isMounted) setIsLoadingRoom(false)
      }
    }

    void fetchAllRoomData()
    return () => {
      isMounted = false
    }
  }, [activeRoomId, currentUser])

  const refreshRoomData = async () => {
    if (!activeRoomId || !currentUser) return
    try {
      const [roomData, expenseData, balanceData, summaryData, activityData] = await Promise.all([
        getRoom(activeRoomId),
        listExpenses(activeRoomId),
        getBalances(activeRoomId),
        getSummary(activeRoomId),
        getActivity(activeRoomId),
      ])

      setRoomContext({ id: roomData.room.publicId, name: roomData.room.name })
      const loadedMembers: RoomMember[] = roomData.members.map((m) => ({
        id: m.userId._id,
        name: m.userId.displayName,
        role: m.role,
        status: m.status,
      }))
      setRoomMembers(loadedMembers)

      const memberNameMap = new Map(loadedMembers.map((m) => [m.id, m.name]))
      const outgoing = balanceData.suggestions.filter((s) => s.fromUserId === currentUser.id)
      const incoming = balanceData.suggestions.filter((s) => s.toUserId === currentUser.id)

      const mappedNeedToPay: PaymentRow[] = outgoing.map((s) => ({
        id: s.toUserId,
        name: memberNameMap.get(s.toUserId) ?? 'Roommate',
        amount: s.amountPaise / 100,
      }))

      const mappedNeedToReceive: PaymentRow[] = incoming.map((s) => ({
        id: s.fromUserId,
        name: memberNameMap.get(s.fromUserId) ?? 'Roommate',
        amount: s.amountPaise / 100,
      }))

      setNeedToPay(mappedNeedToPay)
      setNeedToReceive(mappedNeedToReceive)

      if (mappedNeedToPay.length > 0) {
        setPaymentTarget(mappedNeedToPay[0])
      }

      setExpenses(expenseData.expenses.filter((e) => !e.voidedAt).map(toUiExpense))
      setSummary(summaryData)
      setActivity(activityData.events)

      const currentMember = loadedMembers.find((m) => m.id === currentUser.id)
      if (currentMember?.role === 'admin') {
        const reqs = await listJoinRequests(activeRoomId).catch(() => ({ requests: [] }))
        setJoinRequests(reqs.requests.map((r) => ({ id: r._id, name: r.userId.displayName })))
      }
    } catch {
      showToast('Could not refresh room data.')
    }
  }

  const handleLogin = async (displayName: string) => {
    setLoginError('')
    try {
      const session = await createSession(displayName)
      setCurrentUser(session.user)
      setAuthStatus('ready')
    } catch {
      setLoginError('Could not start your session. Please check that the server is online.')
    }
  }

  const handleLogout = async () => {
    try {
      await logout()
    } catch {
      // Continue client cleanup regardless
    }
    setCurrentUser(null)
    setAuthStatus('loggedOut')
    setActiveRoomId(null)
    setRoomContext(null)
    setUserRooms([])
    setOverlay(null)
    showToast('Signed out')
  }

  const handleAddExpense = async (draft: ExpenseDraft) => {
    if (!roomContext) return
    try {
      await createExpense(roomContext.id, draft)
      setOverlay(null)
      showToast(`${draft.description || 'Expense'} added`)
      await refreshRoomData()
    } catch {
      showToast('Could not add expense. Check participants and amount.')
    }
  }

  const handleEditExpense = async (draft: { description: string; amountPaise: number }) => {
    if (!selectedExpense) return
    try {
      await updateExpense(selectedExpense.apiId, draft)
      setOverlay(null)
      showToast('Expense updated')
      await refreshRoomData()
    } catch {
      showToast('Could not update expense.')
    }
  }

  const handleVoidExpense = async (expenseId: string) => {
    try {
      await voidExpense(expenseId)
      setOverlay(null)
      showToast('Expense voided')
      await refreshRoomData()
    } catch {
      showToast('Could not void expense.')
    }
  }

  const handleOpenHistory = async () => {
    if (!selectedExpense?.apiId) return
    try {
      const res = await getExpenseHistory(selectedExpense.apiId)
      setExpenseHistory(res.history)
      setOverlay('history')
    } catch {
      showToast('Could not load change history.')
    }
  }

  const handleDecideRequest = async (requestId: string, action: 'approve' | 'reject') => {
    if (!roomContext) return
    try {
      await decideJoinRequest(roomContext.id, requestId, action)
      setJoinRequests((curr) => curr.filter((r) => r.id !== requestId))
      await refreshRoomData()
      showToast(action === 'approve' ? 'Roommate approved!' : 'Join request declined')
    } catch {
      showToast('Could not update join request.')
    }
  }

  const handleCreateRoom = async (name: string) => {
    try {
      const res = await createRoom(name)
      const newRoom = res.room
      showToast(`Created room "${newRoom.name}"`)
      const updatedRooms = await listRooms()
      setUserRooms(updatedRooms.rooms)
      setActiveRoomId(newRoom.publicId)
      setOverlay(null)
    } catch {
      showToast('Failed to create room.')
    }
  }

  const handleJoinRoom = async (code: string) => {
    try {
      await joinRoom(code)
      showToast(`Join request submitted for room ${code}`)
      const updatedRooms = await listRooms()
      setUserRooms(updatedRooms.rooms)
      setOverlay(null)
    } catch {
      showToast('Could not find room with that ID or request failed.')
    }
  }

  const handleLeaveRoom = async () => {
    if (!roomContext) return
    try {
      await leaveRoom(roomContext.id)
      showToast(`You left ${roomContext.name}`)
      setOverlay(null)
      const updatedRooms = await listRooms()
      setUserRooms(updatedRooms.rooms)
      const remainingActive = updatedRooms.rooms.filter((r) => r.status === 'active')
      if (remainingActive.length > 0) {
        setActiveRoomId(remainingActive[0].roomId.publicId)
      } else {
        setActiveRoomId(null)
        setRoomContext(null)
      }
    } catch {
      showToast('Could not leave room.')
    }
  }

  const handleExportPdf = async () => {
    if (!roomContext) return
    try {
      const res = await fetch(`/api/rooms/${roomContext.id}/summary.pdf`, { credentials: 'include' })
      if (!res.ok) throw new Error('PDF export failed')
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${roomContext.name.toLowerCase().replace(/\s+/g, '-')}-summary.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      showToast('Summary PDF downloaded')
    } catch {
      showToast('Failed to download PDF summary')
    }
  }

  // If session is checking
  if (authStatus === 'checking') {
    return (
      <div className="login-page">
        <div className="loading-box">
          <div className="loading-spinner" />
          <p>Connecting to Flatmate Finance...</p>
        </div>
      </div>
    )
  }

  // If user is logged out
  if (authStatus !== 'ready' || !currentUser) {
    return <LoginPage error={loginError} onSubmit={handleLogin} />
  }

  // If authenticated but user has no active rooms
  if (!roomContext && !isLoadingRoom) {
    return (
      <div className="app-shell">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark">ff</span>
            <span>flatmate finance</span>
          </div>
          <div className="user-badge">
            <span className="avatar-circle">{currentUser.displayName[0]?.toUpperCase()}</span>
            <span>{currentUser.displayName}</span>
          </div>
        </header>
        <main className="main-content">
          <div className="onboarding-box">
            <p className="eyebrow">Welcome, {currentUser.displayName}</p>
            <h2>Let's set up your home</h2>
            <p>You are not currently part of an active room. Create a new flat for your roommates or join an existing flat using a Room ID.</p>
            <div className="onboarding-actions">
              <button className="primary-button" onClick={() => setOverlay('create-room')}>
                + Create a new room <span>→</span>
              </button>
              <button className="secondary-button" onClick={() => setOverlay('join-room')}>
                Join with Room ID <span>→</span>
              </button>
              <button className="logout-btn" onClick={() => void handleLogout()}>
                Sign out
              </button>
            </div>
          </div>
        </main>
        {overlay === 'create-room' && (
          <CreateRoomModal onClose={() => setOverlay(null)} onSubmit={handleCreateRoom} />
        )}
        {overlay === 'join-room' && (
          <JoinRoomModal onClose={() => setOverlay(null)} onSubmit={handleJoinRoom} />
        )}
        {toast && (
          <div className="toast" role="status">
            {toast}
            <span>✓</span>
          </div>
        )}
      </div>
    )
  }

  const activeMembers = roomMembers.filter((m) => m.status === 'active')

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView('home')} aria-label="Go to home">
          <span className="brand-mark">ff</span>
          <span>flatmate finance</span>
        </button>
        <nav className="desktop-nav" aria-label="Desktop navigation">
          <NavButton active={view === 'home'} label="Home" icon="" onClick={() => setView('home')} />
          <NavButton active={view === 'activity'} label="Activity" icon="" onClick={() => setView('activity')} />
          <NavButton active={view === 'room'} label="Room" icon="" onClick={() => setView('room')} />
          <button className="desktop-add" onClick={() => setOverlay('add')}>
            + Add expense
          </button>
        </nav>
        <button
          className="avatar-button"
          onClick={() => setOverlay('rooms')}
          aria-label="User profile and room switch"
          title={`Signed in as ${currentUser.displayName}. Switch rooms or manage profile`}
        >
          {currentUser.displayName[0]?.toUpperCase()}
          <span className="status-dot" />
        </button>
      </header>

      <main className="main-content">
        {isLoadingRoom ? (
          <div className="loading-box">
            <div className="loading-spinner" />
            <p>Loading {roomContext?.name || 'room'}...</p>
          </div>
        ) : (
          <>
            {view === 'home' && roomContext && (
              <Home
                room={roomContext}
                memberCount={activeMembers.length}
                expenses={expenses}
                needToPay={needToPay}
                needToReceive={needToReceive}
                summary={summary}
                onAdd={() => setOverlay('add')}
                onPay={(target) => {
                  setPaymentTarget(target)
                  setOverlay('pay')
                }}
                onExpense={(exp) => {
                  setSelectedExpense(exp)
                  setOverlay('expense')
                }}
                onExport={() => void handleExportPdf()}
              />
            )}
            {view === 'activity' && <Activity events={activity} />}
            {view === 'room' && roomContext && (
              <Room
                room={roomContext}
                members={roomMembers}
                currentUserId={currentUser.id}
                requests={joinRequests}
                onRequest={handleDecideRequest}
                onLeave={() => setOverlay('leave')}
                onToast={showToast}
              />
            )}
          </>
        )}
      </main>

      <nav className="bottom-nav" aria-label="Primary navigation">
        <NavButton active={view === 'home'} label="Home" icon="⌂" onClick={() => setView('home')} />
        <button className="add-button" onClick={() => setOverlay('add')} aria-label="Add expense">
          <span>+</span>
          <small>Add expense</small>
        </button>
        <NavButton active={view === 'activity'} label="Activity" icon="◷" onClick={() => setView('activity')} />
        <NavButton active={view === 'room'} label="Room" icon="⌂" onClick={() => setView('room')} />
      </nav>

      {/* MODALS */}
      {overlay === 'add' && (
        <AddExpense
          availableMembers={activeMembers}
          currentUserId={currentUser.id}
          onClose={() => setOverlay(null)}
          onSubmit={handleAddExpense}
        />
      )}

      {overlay === 'expense' && selectedExpense && (
        <ExpenseDetails
          expense={selectedExpense}
          onClose={() => setOverlay(null)}
          onEdit={() => setOverlay('edit')}
          onHistory={() => void handleOpenHistory()}
          onVoid={() => void handleVoidExpense(selectedExpense.apiId)}
        />
      )}

      {overlay === 'edit' && selectedExpense && (
        <EditExpense
          expense={selectedExpense}
          onClose={() => setOverlay('expense')}
          onSubmit={handleEditExpense}
        />
      )}

      {overlay === 'history' && (
        <HistoryModal history={expenseHistory} onClose={() => setOverlay('expense')} />
      )}

      {overlay === 'pay' && roomContext && paymentTarget && (
        <PayBack
          roomId={roomContext.id}
          target={paymentTarget}
          availableTargets={needToPay}
          onSelectTarget={(target) => setPaymentTarget(target)}
          onClose={() => setOverlay(null)}
          onToast={showToast}
          onRefresh={refreshRoomData}
        />
      )}

      {overlay === 'rooms' && (
        <RoomSwitcher
          currentUser={currentUser}
          currentRoomId={activeRoomId}
          rooms={userRooms}
          onSelectRoom={(code) => {
            startTransition(() => {
              setActiveRoomId(code)
            })
            setOverlay(null)
          }}
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          onLogout={() => void handleLogout()}
          onClose={() => setOverlay(null)}
        />
      )}

      {overlay === 'leave' && roomContext && (
        <LeaveRoom
          roomId={roomContext.id}
          roomName={roomContext.name}
          outstandingPay={needToPay.reduce((acc, row) => acc + row.amount, 0)}
          outstandingReceive={needToReceive.reduce((acc, row) => acc + row.amount, 0)}
          onClose={() => setOverlay(null)}
          onConfirm={handleLeaveRoom}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
          <span>✓</span>
        </div>
      )}
    </div>
  )
}

// -------------------------------------------------------------------------
// LOGIN PAGE
// -------------------------------------------------------------------------
function LoginPage({ error, onSubmit }: { error: string; onSubmit: (displayName: string) => Promise<void> }) {
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!displayName.trim() || loading) return
    setLoading(true)
    try {
      await onSubmit(displayName.trim())
    } finally {
      setLoading(false)
    }
  }

  const quickLogin = async (name: string) => {
    setDisplayName(name)
    setLoading(true)
    try {
      await onSubmit(name)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-page">
      <div className="login-mark">ff</div>
      <p className="eyebrow">Your room's money</p>
      <h1>
        Welcome to
        <br />
        <em>flatmate finance</em>
      </h1>
      <p className="login-copy">A calm, reliable place to track shared expenses and settle balances with your flatmates.</p>
      <form className="login-form" onSubmit={submit}>
        <label htmlFor="display-name">What should we call you?</label>
        <input
          id="display-name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="e.g. Akshay, Rahul, Priya..."
          autoComplete="name"
          autoFocus
          required
          maxLength={80}
        />
        <button className="primary-button" type="submit" disabled={loading}>
          {loading ? 'Signing in...' : 'Continue'} <span>→</span>
        </button>
      </form>

      <div style={{ marginTop: 28, width: '100%' }}>
        <p className="eyebrow" style={{ marginBottom: 6 }}>
          Quick sign in (Sample roommates):
        </p>
        <div className="quick-users">
          {['Akshay', 'Rahul', 'Priya', 'Aman'].map((name) => (
            <button key={name} type="button" className="quick-user-btn" onClick={() => void quickLogin(name)}>
              {name}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="login-error" role="alert">
          {error}
        </p>
      )}
      <small className="login-note">
        {apiIsConfigured ? 'Live API connected · Secure HttpOnly session' : 'Preview mode · connect API'}
      </small>
    </main>
  )
}

// -------------------------------------------------------------------------
// NAVIGATION BUTTON
// -------------------------------------------------------------------------
function NavButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean
  label: string
  icon: string
  onClick: () => void
}) {
  return (
    <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>
      {icon && <span className="nav-icon">{icon}</span>}
      <span>{label}</span>
    </button>
  )
}

// -------------------------------------------------------------------------
// HOME VIEW
// -------------------------------------------------------------------------
function Home({
  room,
  memberCount,
  expenses,
  needToPay,
  needToReceive,
  summary,
  onAdd,
  onPay,
  onExpense,
  onExport,
}: {
  room: { id: string; name: string }
  memberCount: number
  expenses: Expense[]
  needToPay: PaymentRow[]
  needToReceive: PaymentRow[]
  summary: ApiSummary
  onAdd: () => void
  onPay: (target: PaymentRow) => void
  onExpense: (expense: Expense) => void
  onExport: () => void
}) {
  const toPay = needToPay.reduce((total, row) => total + row.amount, 0)
  const toReceive = needToReceive.reduce((total, row) => total + row.amount, 0)
  const balance = toReceive - toPay
  const balanceLabel = balance === 0 ? '₹0' : `${balance > 0 ? '+' : '-'}${money(Math.abs(balance))}`

  return (
    <div className="home-layout">
      <section className="intro-row">
        <div>
          <p className="eyebrow">Your shared home</p>
          <h1>{room.name}</h1>
          <p className="muted">
            {memberCount} {memberCount === 1 ? 'roommate' : 'roommates'} <span className="tiny-dot">·</span> Room ID{' '}
            <strong style={{ fontFamily: 'var(--mono)' }}>{room.id}</strong>
          </p>
        </div>
        <button className="round-action" onClick={onAdd} aria-label="Add expense" title="Add new expense">
          +
        </button>
      </section>

      <section className="balance-hero">
        <p className="eyebrow">Your net balance</p>
        <div className="balance-number" style={{ color: balance < 0 ? 'var(--red)' : 'var(--green)' }}>
          {balanceLabel}
        </div>
        <p className="balance-caption">
          <span>{money(toPay)} to pay</span>
          <i>·</i>
          <span>{money(toReceive)} to receive</span>
        </p>
      </section>

      <section className="money-grid">
        <MoneySection
          title="You need to pay"
          rows={needToPay}
          emptyText="You're all settled! No payments due."
          action="Pay back"
          onAction={(row) => onPay(row)}
        />
        <MoneySection
          title="Others need to pay you"
          rows={needToReceive}
          emptyText="Nobody owes you right now."
        />
      </section>

      <section className="section-block monthly-section">
        <SectionTitle title="My monthly status" action="Export PDF" onAction={onExport} />
        <div className="status-grid">
          <StatusItem label="You paid" value={money(summary.youPaidPaise / 100)} />
          <StatusItem label="Paid for others" value={money(summary.paidForOthersPaise / 100)} />
          <StatusItem label="Your share" value={money(summary.yourSharePaise / 100)} />
          <StatusItem label="Room spent" value={money(summary.roomSpentPaise / 100)} />
        </div>
      </section>

      <section className="section-block recent-section">
        <SectionTitle title="Recent expenses" />
        {expenses.length > 0 ? (
          <div className="expense-list">
            {expenses.map((expense) => (
              <ExpenseRow key={expense.id} expense={expense} onClick={() => onExpense(expense)} />
            ))}
          </div>
        ) : (
          <div className="empty-card">
            <p>No expenses recorded yet in this room.</p>
            <p style={{ marginTop: 6 }}>Tap <strong>+ Add expense</strong> to add your first grocery or bill.</p>
          </div>
        )}
      </section>
    </div>
  )
}

function SectionTitle({
  title,
  action,
  onAction,
}: {
  title: string
  action?: string
  onAction?: () => void
}) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {action && (
        <button className="text-button" onClick={onAction}>
          {action}
          <span>↗</span>
        </button>
      )}
    </div>
  )
}

function MoneySection({
  title,
  rows,
  emptyText,
  action,
  onAction,
}: {
  title: string
  rows: PaymentRow[]
  emptyText: string
  action?: string
  onAction?: (row: PaymentRow) => void
}) {
  return (
    <section className="money-section">
      <div className="section-title">
        <h2>{title}</h2>
      </div>
      {rows.length > 0 ? (
        rows.map((row) => (
          <button
            className="money-row"
            key={row.id}
            onClick={() => onAction?.(row)}
            title={action ? `${action} ${row.name}` : undefined}
          >
            <span className="person-initial">{row.name[0]?.toUpperCase() ?? '?'}</span>
            <span className="person-name">{row.name}</span>
            <strong>{money(row.amount)}</strong>
            {action ? (
              <span style={{ fontSize: 11, color: 'var(--green)', marginLeft: 8, fontWeight: 600 }}>{action} ›</span>
            ) : (
              <span className="chevron">›</span>
            )}
          </button>
        ))
      ) : (
        <div className="empty-card">
          <p>{emptyText}</p>
        </div>
      )}
    </section>
  )
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="status-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function ExpenseRow({ expense, onClick }: { expense: Expense; onClick: () => void }) {
  const getIcon = (title: string) => {
    const lower = title.toLowerCase()
    if (lower.includes('electric') || lower.includes('power') || lower.includes('bill')) return '↯'
    if (lower.includes('milk') || lower.includes('egg') || lower.includes('grocery') || lower.includes('food')) return '◒'
    if (lower.includes('wifi') || lower.includes('internet')) return '📶'
    if (lower.includes('rent')) return '🏠'
    return '✣'
  }

  return (
    <button className="expense-row" onClick={onClick}>
      <span className="expense-icon">{getIcon(expense.title)}</span>
      <span className="expense-info">
        <strong>
          {expense.title}
          {expense.edited && <em>Edited</em>}
        </strong>
        <small>
          Paid by {expense.paidBy} <span>·</span> {expense.date}
        </small>
      </span>
      <strong className="expense-amount">{money(expense.amount)}</strong>
      <span className="chevron">›</span>
    </button>
  )
}

// -------------------------------------------------------------------------
// ACTIVITY VIEW
// -------------------------------------------------------------------------
function Activity({ events }: { events: ApiActivity[] }) {
  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">The room, in motion</p>
        <h1>Activity</h1>
        <p className="muted">A real-time record of all expenses, payments, and member changes.</p>
      </section>
      <section className="activity-list">
        {events.length ? (
          events.map((event) => {
            const parsed = formatActivity(event)
            return (
              <ActivityItem
                key={event._id}
                title={parsed.title}
                detail={parsed.detail}
                time={new Date(event.createdAt).toLocaleString('en-IN', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              />
            )
          })
        ) : (
          <p className="muted empty-copy">No activity yet. Changes in your room will appear here.</p>
        )}
      </section>
    </>
  )
}

function formatActivity(event: ApiActivity): { title: string; detail: string } {
  const actor = event.actorId?.displayName ?? 'A roommate'
  const action = event.action

  if (action === 'expense.created') {
    const desc = (event.newValues?.description as string) || 'Shared expense'
    const paise = (event.newValues?.amountPaise as number) || 0
    return { title: `${actor} added an expense`, detail: `${desc} · ₹${(paise / 100).toLocaleString('en-IN')}` }
  }
  if (action === 'expense.updated') {
    const desc = (event.newValues?.description as string) || 'Expense'
    return { title: `${actor} updated an expense`, detail: `Modified ${desc}` }
  }
  if (action === 'expense.voided') {
    return { title: `${actor} voided an expense`, detail: 'Removed from room totals' }
  }
  if (action === 'payment.created') {
    const paise = (event.newValues?.amountPaise as number) || 0
    return { title: `${actor} recorded a payment`, detail: `Settlement of ₹${(paise / 100).toLocaleString('en-IN')}` }
  }
  if (action === 'membership.approve') {
    return { title: `${actor} approved a new roommate`, detail: 'New member joined the room' }
  }
  if (action === 'membership.reject') {
    return { title: `${actor} declined a join request`, detail: 'Join request closed' }
  }
  if (action === 'membership.left') {
    return { title: `${actor} left the room`, detail: 'Room membership ended' }
  }

  return { title: `${actor} ${action.replace('.', ' ')}`, detail: 'Room updated' }
}

function ActivityItem({ title, detail, time }: { title: string; detail: string; time: string }) {
  return (
    <div className="activity-item">
      <span className="activity-line" />
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
        <small>{time}</small>
      </div>
    </div>
  )
}

// -------------------------------------------------------------------------
// ROOM VIEW
// -------------------------------------------------------------------------
function Room({
  room,
  members,
  currentUserId,
  requests,
  onRequest,
  onLeave,
  onToast,
}: {
  room: { id: string; name: string }
  members: RoomMember[]
  currentUserId: string
  requests: JoinRequest[]
  onRequest: (requestId: string, action: 'approve' | 'reject') => Promise<void>
  onLeave: () => void
  onToast: (message: string) => void
}) {
  const activeMembers = members.filter((m) => m.status === 'active')
  const formerMembers = members.filter((m) => m.status === 'left')

  return (
    <>
      <section className="page-heading room-heading">
        <p className="eyebrow">The details</p>
        <h1>{room.name}</h1>
        <div className="room-id">
          <span>
            Room ID <strong>{room.id}</strong>
          </span>
          <button
            className="text-button"
            onClick={() => {
              void navigator.clipboard?.writeText(room.id)
              onToast('Room ID copied to clipboard!')
            }}
          >
            Copy ID <span>↗</span>
          </button>
        </div>
      </section>

      <section className="room-section">
        <SectionTitle title={`Roommates (${activeMembers.length})`} />
        {activeMembers.map((member) => (
          <Roommate
            key={member.id}
            name={member.name}
            detail={
              member.id === currentUserId
                ? member.role === 'admin'
                  ? 'You (Admin)'
                  : 'You'
                : member.role === 'admin'
                ? 'Room Admin'
                : 'Roommate'
            }
          />
        ))}
      </section>

      {requests.length > 0 && (
        <section className="request-block">
          <div>
            <p className="eyebrow">Pending Join Requests</p>
            {requests.map((request) => (
              <strong key={request.id} className="request-name">
                {request.name} wants to join
              </strong>
            ))}
          </div>
          <div className="request-actions">
            {requests.map((request) => (
              <span key={request.id} style={{ display: 'inline-flex', gap: 8 }}>
                <button onClick={() => void onRequest(request.id, 'approve')}>Approve</button>
                <button className="quiet-button" onClick={() => void onRequest(request.id, 'reject')}>
                  Decline
                </button>
              </span>
            ))}
          </div>
        </section>
      )}

      {formerMembers.length > 0 && (
        <section className="former-section">
          <SectionTitle title="Former roommates" />
          {formerMembers.map((member) => (
            <div key={member.id} className="former-person">
              <span>
                <strong>{member.name}</strong>
                <small>Historical records preserved</small>
              </span>
            </div>
          ))}
        </section>
      )}

      <button className="leave-button" onClick={onLeave}>
        Leave room <span>→</span>
      </button>
    </>
  )
}

function Roommate({ name, detail }: { name: string; detail: string }) {
  return (
    <div className="roommate">
      <span className="person-initial">{name[0]?.toUpperCase()}</span>
      <span>
        <strong>{name}</strong>
        <small>{detail}</small>
      </span>
      <span className="chevron">›</span>
    </div>
  )
}

// -------------------------------------------------------------------------
// ADD EXPENSE MODAL
// -------------------------------------------------------------------------
function AddExpense({
  availableMembers,
  currentUserId,
  onClose,
  onSubmit,
}: {
  availableMembers: RoomMember[]
  currentUserId: string
  onClose: () => void
  onSubmit: (draft: ExpenseDraft) => Promise<void>
}) {
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [payerId, setPayerId] = useState(currentUserId)
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>(availableMembers.map((m) => m.id))
  const [submitting, setSubmitting] = useState(false)

  const numAmount = Number(amount) || 0
  const splitCount = selectedMemberIds.length
  const splitAmount = numAmount && splitCount ? numAmount / splitCount : 0
  const splitLabel = splitAmount
    ? `₹${splitAmount.toLocaleString('en-IN', {
        minimumFractionDigits: splitAmount % 1 ? 2 : 0,
        maximumFractionDigits: 2,
      })} each (${splitCount} people)`
    : 'Select roommates'

  const toggleMember = (id: string) => {
    setSelectedMemberIds((curr) =>
      curr.includes(id) ? (curr.length > 1 ? curr.filter((m) => m !== id) : curr) : [...curr, id]
    )
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!numAmount || splitCount === 0 || submitting) return
    setSubmitting(true)
    try {
      await onSubmit({
        description: description.trim() || undefined,
        amountPaise: Math.round(numAmount * 100),
        payerId,
        participantIds: selectedMemberIds,
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal title="Add an expense" onClose={onClose}>
      <form className="expense-form" onSubmit={submit}>
        <label className="amount-field">
          <span>Amount</span>
          <div>
            <b>₹</b>
            <input
              name="amount"
              type="number"
              step="any"
              min="0.01"
              inputMode="decimal"
              placeholder="0"
              autoFocus
              required
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
        </label>

        <label>
          What was it? <span className="form-optional">(optional)</span>
          <input
            name="title"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Groceries, Electricity, WiFi"
            maxLength={120}
          />
        </label>

        <label>
          Paid by
          <select
            className="select-native"
            value={payerId}
            onChange={(e) => setPayerId(e.target.value)}
          >
            {availableMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} {m.id === currentUserId ? '(You)' : ''}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="member-field">
          <legend>Shared with</legend>
          <div className="member-list">
            {availableMembers.map((member) => {
              const selected = selectedMemberIds.includes(member.id)
              return (
                <button
                  type="button"
                  key={member.id}
                  className={`member-option ${selected ? 'selected' : ''}`}
                  aria-pressed={selected}
                  onClick={() => toggleMember(member.id)}
                >
                  <span className="member-check">{selected ? '✓' : '×'}</span>
                  {member.name}
                </button>
              )
            })}
          </div>
        </fieldset>

        <div className="split-choice">
          <span>How to split</span>
          <strong>
            Split equally <small>{splitLabel}</small>
          </strong>
        </div>

        <button className="primary-button" type="submit" disabled={submitting || !numAmount}>
          {submitting ? 'Adding...' : 'Add expense'} <span>→</span>
        </button>
      </form>
    </Modal>
  )
}

// -------------------------------------------------------------------------
// EXPENSE DETAILS MODAL
// -------------------------------------------------------------------------
function ExpenseDetails({
  expense,
  onClose,
  onEdit,
  onHistory,
  onVoid,
}: {
  expense: Expense
  onClose: () => void
  onEdit: () => void
  onHistory: () => void
  onVoid: () => void
}) {
  const [confirmVoid, setConfirmVoid] = useState(false)
  const share = expense.amount / expense.participantCount

  return (
    <Modal title="Expense details" onClose={onClose}>
      <div className="detail-hero">
        <span className="expense-icon">✣</span>
        <h2>{expense.title}</h2>
        <strong>{money(expense.amount)}</strong>
        {expense.edited && <em>Edited</em>}
      </div>
      <div className="detail-list">
        <Detail label="Paid by" value={expense.paidBy} />
        <Detail label="Shared with" value={`${expense.participantCount} roommates`} />
        <Detail label="How it was split" value="Split equally" />
        <Detail
          label="Each person's share"
          value={`₹${share.toLocaleString('en-IN', {
            minimumFractionDigits: share % 1 ? 2 : 0,
            maximumFractionDigits: 2,
          })}`}
        />
        <Detail label="Date" value={expense.date} />
      </div>

      <div className="detail-actions">
        <button onClick={onEdit}>Edit</button>
        <button onClick={onHistory}>History</button>
      </div>

      <div style={{ marginTop: 18 }}>
        {confirmVoid ? (
          <div style={{ background: '#faf0ed', padding: 12, borderRadius: 4, textAlign: 'center' }}>
            <p style={{ fontSize: 12, color: 'var(--red)', marginBottom: 10 }}>
              Voiding cancels this expense from all balances.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="leave-confirm" style={{ margin: 0 }} onClick={onVoid}>
                Yes, void expense
              </button>
              <button className="secondary-button" style={{ margin: 0 }} onClick={() => setConfirmVoid(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button className="void-button" style={{ width: '100%' }} onClick={() => setConfirmVoid(true)}>
            Void this expense
          </button>
        )}
      </div>
    </Modal>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

// -------------------------------------------------------------------------
// EDIT EXPENSE MODAL
// -------------------------------------------------------------------------
function EditExpense({
  expense,
  onClose,
  onSubmit,
}: {
  expense: Expense
  onClose: () => void
  onSubmit: (draft: { description: string; amountPaise: number }) => Promise<void>
}) {
  const [title, setTitle] = useState(expense.title)
  const [amount, setAmount] = useState(String(expense.amount))
  const [saving, setSaving] = useState(false)

  return (
    <Modal title="Edit expense" onClose={onClose}>
      <form
        className="expense-form"
        onSubmit={async (event) => {
          event.preventDefault()
          if (!Number(amount) || saving) return
          setSaving(true)
          try {
            await onSubmit({
              description: title.trim() || 'Shared expense',
              amountPaise: Math.round(Number(amount) * 100),
            })
          } finally {
            setSaving(false)
          }
        }}
      >
        <label>
          What was it?
          <input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={120} />
        </label>
        <label className="amount-field">
          <span>Amount</span>
          <div>
            <b>₹</b>
            <input
              type="number"
              step="any"
              min="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
            />
          </div>
        </label>
        <button className="primary-button" type="submit" disabled={saving}>
          {saving ? 'Saving...' : 'Save changes'} <span>→</span>
        </button>
      </form>
    </Modal>
  )
}

// -------------------------------------------------------------------------
// HISTORY MODAL
// -------------------------------------------------------------------------
function HistoryModal({ history, onClose }: { history: ApiActivity[]; onClose: () => void }) {
  return (
    <Modal title="Change history" onClose={onClose}>
      <div className="history-list">
        {history.length ? (
          history.map((event) => (
            <div className="history-item" key={event._id}>
              <strong>
                {event.actorId?.displayName ?? 'A roommate'} {event.action.replace('.', ' ')}
              </strong>
              <small>
                {new Date(event.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
              </small>
            </div>
          ))
        ) : (
          <p className="muted">No changes recorded yet.</p>
        )}
      </div>
    </Modal>
  )
}

// -------------------------------------------------------------------------
// PAY BACK MODAL
// -------------------------------------------------------------------------
function PayBack({
  roomId,
  target,
  availableTargets,
  onSelectTarget,
  onClose,
  onToast,
  onRefresh,
}: {
  roomId: string
  target: PaymentRow
  availableTargets: PaymentRow[]
  onSelectTarget: (target: PaymentRow) => void
  onClose: () => void
  onToast: (message: string) => void
  onRefresh: () => Promise<void>
}) {
  const [amount, setAmount] = useState(String(Math.min(target.amount, target.amount)))
  const [submitting, setSubmitting] = useState(false)

  const numAmount = Number(amount) || 0
  const remaining = Math.max(0, target.amount - numAmount)

  const submit = async () => {
    if (numAmount <= 0 || numAmount > target.amount || submitting) return
    setSubmitting(true)
    const amountPaise = Math.round(numAmount * 100)
    try {
      await recordPayment(roomId, target.id, amountPaise)
      await onRefresh()
      onClose()
      onToast(`Recorded payment of ${money(numAmount)} to ${target.name}`)
    } catch {
      onToast("Couldn't record payment. Check amount does not exceed balance.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal title={`Pay ${target.name}`} onClose={onClose}>
      <div className="pay-intro">
        <span className="person-initial">{target.name[0]?.toUpperCase()}</span>
        <p>
          You owe {target.name} <strong>{money(target.amount)}</strong>
        </p>
      </div>

      {availableTargets.length > 1 && (
        <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 16 }}>
          Paying to
          <select
            className="select-native"
            value={target.id}
            onChange={(e) => {
              const selected = availableTargets.find((t) => t.id === e.target.value)
              if (selected) {
                onSelectTarget(selected)
                setAmount(String(selected.amount))
              }
            }}
          >
            {availableTargets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} (Owe {money(t.amount)})
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="amount-field">
        <span>Amount paid</span>
        <div>
          <b>₹</b>
          <input
            type="number"
            step="any"
            max={target.amount}
            min="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
      </label>

      <div className="remaining">
        <span>Remaining after payment</span>
        <strong>{money(remaining)}</strong>
      </div>

      <button
        className="primary-button"
        disabled={numAmount <= 0 || numAmount > target.amount || submitting}
        onClick={() => void submit()}
      >
        {submitting ? 'Recording...' : 'Record payment'} <span>→</span>
      </button>
    </Modal>
  )
}

// -------------------------------------------------------------------------
// ROOM SWITCHER & PROFILE MODAL
// -------------------------------------------------------------------------
function RoomSwitcher({
  currentUser,
  currentRoomId,
  rooms,
  onSelectRoom,
  onCreateRoom,
  onJoinRoom,
  onLogout,
  onClose,
}: {
  currentUser: CurrentUser
  currentRoomId: string | null
  rooms: ApiRoomMembership[]
  onSelectRoom: (code: string) => void
  onCreateRoom: (name: string) => Promise<void>
  onJoinRoom: (code: string) => Promise<void>
  onLogout: () => void
  onClose: () => void
}) {
  const [roomName, setRoomName] = useState('')
  const [roomId, setRoomId] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [isJoining, setIsJoining] = useState(false)

  const submitCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!roomName.trim() || isCreating) return
    setIsCreating(true)
    try {
      await onCreateRoom(roomName.trim())
    } finally {
      setIsCreating(false)
    }
  }

  const submitJoin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!roomId.trim() || isJoining) return
    setIsJoining(true)
    try {
      await onJoinRoom(roomId.trim().toUpperCase())
    } finally {
      setIsJoining(false)
    }
  }

  return (
    <Modal title="Rooms & Account" onClose={onClose}>
      <div className="profile-modal-header">
        <div className="profile-modal-avatar">{currentUser.displayName[0]?.toUpperCase()}</div>
        <div className="profile-modal-info">
          <strong>{currentUser.displayName}</strong>
          <small>Signed in via Flatmate Finance</small>
        </div>
      </div>

      <p className="eyebrow">Your Rooms ({rooms.length})</p>
      <div className="room-switcher-list">
        {rooms.length > 0 ? (
          rooms.map((membership) => {
            const isCurrent = membership.roomId.publicId === currentRoomId
            const isPending = membership.status === 'pending'
            return (
              <button
                key={membership._id}
                type="button"
                className={`room-card-btn ${isCurrent ? 'active' : ''}`}
                onClick={() => {
                  if (!isPending) onSelectRoom(membership.roomId.publicId)
                }}
                disabled={isPending}
              >
                <div className="room-card-info">
                  <strong>{membership.roomId.name}</strong>
                  <small>Room ID: {membership.roomId.publicId}</small>
                </div>
                <div>
                  {isPending && <span className="room-pill pending">Pending</span>}
                  {!isPending && isCurrent && <span className="room-pill active">Current</span>}
                  {!isPending && !isCurrent && membership.role === 'admin' && (
                    <span className="room-pill admin">Admin</span>
                  )}
                </div>
              </button>
            )
          })
        ) : (
          <div className="empty-card">
            <p>No rooms found.</p>
          </div>
        )}
      </div>

      <form className="room-form" onSubmit={submitCreate}>
        <label>
          Create a new room
          <input
            value={roomName}
            onChange={(event) => setRoomName(event.target.value)}
            placeholder="e.g. Maple House 4B"
            required
            maxLength={60}
          />
        </label>
        <button className="secondary-button" type="submit" disabled={isCreating}>
          {isCreating ? 'Creating...' : '+ Create room'}
        </button>
      </form>

      <form className="room-form" onSubmit={submitJoin}>
        <label>
          Join with Room ID
          <input
            value={roomId}
            onChange={(event) => setRoomId(event.target.value.toUpperCase())}
            placeholder="e.g. GP7K29"
            required
            maxLength={12}
          />
        </label>
        <button className="secondary-button" type="submit" disabled={isJoining}>
          {isJoining ? 'Joining...' : 'Request to join'}
        </button>
      </form>

      <button className="logout-btn" onClick={onLogout}>
        Sign out
      </button>
    </Modal>
  )
}

// -------------------------------------------------------------------------
// ONBOARDING CREATE & JOIN MODALS
// -------------------------------------------------------------------------
function CreateRoomModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (name: string) => Promise<void> }) {
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  return (
    <Modal title="Create a new room" onClose={onClose}>
      <form
        className="expense-form"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!name.trim() || submitting) return
          setSubmitting(true)
          try {
            await onSubmit(name.trim())
          } finally {
            setSubmitting(false)
          }
        }}
      >
        <label>
          Room name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Green Park Flat, Flat 402"
            autoFocus
            required
          />
        </label>
        <button className="primary-button" type="submit" disabled={submitting}>
          {submitting ? 'Creating...' : 'Create room'} <span>→</span>
        </button>
      </form>
    </Modal>
  )
}

function JoinRoomModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (code: string) => Promise<void> }) {
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  return (
    <Modal title="Join room with ID" onClose={onClose}>
      <form
        className="expense-form"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!code.trim() || submitting) return
          setSubmitting(true)
          try {
            await onSubmit(code.trim().toUpperCase())
          } finally {
            setSubmitting(false)
          }
        }}
      >
        <label>
          Room ID
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. GP7K29"
            autoFocus
            required
          />
        </label>
        <button className="primary-button" type="submit" disabled={submitting}>
          {submitting ? 'Requesting...' : 'Request to join'} <span>→</span>
        </button>
      </form>
    </Modal>
  )
}

// -------------------------------------------------------------------------
// LEAVE ROOM MODAL
// -------------------------------------------------------------------------
function LeaveRoom({
  roomName,
  outstandingPay,
  outstandingReceive,
  onClose,
  onConfirm,
}: {
  roomId: string
  roomName: string
  outstandingPay: number
  outstandingReceive: number
  onClose: () => void
  onConfirm: () => Promise<void>
}) {
  const [leaving, setLeaving] = useState(false)

  return (
    <Modal title="Leave room" onClose={onClose}>
      <div className="leave-warning">
        <span>!</span>
        <div>
          {outstandingPay > 0 ? (
            <p>
              You still owe <strong>{money(outstandingPay)}</strong> in this room.
              <br />
              Leaving does not erase financial records.
            </p>
          ) : outstandingReceive > 0 ? (
            <p>
              Roommates still owe you <strong>{money(outstandingReceive)}</strong>.
              <br />
              Leaving will preserve the historical record.
            </p>
          ) : (
            <p>
              Your balance in this room is completely settled (₹0).
              <br />
              Leaving will archive your active membership.
            </p>
          )}
        </div>
      </div>
      <button
        className="leave-confirm"
        disabled={leaving}
        onClick={async () => {
          setLeaving(true)
          await onConfirm()
        }}
      >
        {leaving ? 'Leaving room...' : `Leave ${roomName}`}
      </button>
      <button className="secondary-button" onClick={onClose}>
        Stay in room
      </button>
    </Modal>
  )
}

// -------------------------------------------------------------------------
// BASE MODAL
// -------------------------------------------------------------------------
function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section className="modal-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-handle" />
        <div className="modal-header">
          <h2>{title}</h2>
          <button onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
  )
}

export default App
