import React, { useEffect, useState, useTransition } from 'react'
import './App.css'
import {
  apiIsConfigured,
  createExpense,
  createRoom,
  createSession,
  decideJoinRequest,
  decidePayment,
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
  recoverRoom,
  removeMember,
  updateExpense,
  voidExpense,
  type ApiActivity,
  type ApiExpense,
  type ApiPendingPayment,
  type ApiRoomMembership,
  type ApiSummary,
  type ExpenseDraft,
} from './services/api'

type View = 'home' | 'activity' | 'room'
type Overlay = 'add' | 'expense' | 'edit' | 'history' | 'pay' | 'rooms' | 'leave' | null

type Expense = {
  id: string
  apiId: string
  title: string
  amount: number
  paidBy: string
  payerId: string
  participantCount: number
  participantIds: string[]
  date: string
  rawDate: string
  note: string
  edited?: boolean
}

type RoomMember = {
  id: string
  membershipId: string
  name: string
  role: 'admin' | 'member'
  status: 'active' | 'left'
}

type RoomContext = {
  id: string
  name: string
  recoveryQuestion?: string
  dissolveRequest?: {
    requestedBy: string
    requestedAt: string
    status: 'pending' | 'approved' | 'rejected'
    approvals: Array<{ userId: string; approved: boolean; decidedAt?: string }>
  }
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
  const payerName =
    typeof expense.payerId === 'object' && expense.payerId !== null
      ? expense.payerId.displayName
      : 'Roommate'
  const payerId =
    typeof expense.payerId === 'object' && expense.payerId !== null
      ? expense.payerId._id
      : String(expense.payerId)
  const participantIds =
    expense.participants?.map(String) ||
    expense.allocations?.map((a) => String(a.userId)) ||
    []

  return {
    id: expense._id,
    apiId: expense._id,
    title: expense.description || 'Shared Expense',
    amount: expense.amountPaise / 100,
    paidBy: payerName,
    payerId,
    participantCount: Math.max(1, participantIds.length),
    participantIds,
    date: new Date(expense.expenseDate).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
    }),
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
  const [isCheckingApproval, setIsCheckingApproval] = useState(false)
  const [, startTransition] = useTransition()

  // Room state
  const [userRooms, setUserRooms] = useState<ApiRoomMembership[]>([])
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null)
  const [roomContext, setRoomContext] = useState<RoomContext | null>(null)
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
  const [incomingPayments, setIncomingPayments] = useState<ApiPendingPayment[]>([])
  const [outgoingPayments, setOutgoingPayments] = useState<ApiPendingPayment[]>([])
  // PWA Install Prompt State
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const [isBootstrapping, setIsBootstrapping] = useState(true)

  function showToast(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(''), 3000)
  }

  // PWA beforeinstallprompt handler
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e)
    }
    const handleAppInstalled = () => {
      setDeferredPrompt(null)
      showToast('FinLit installed successfully!')
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  // 1. Initial auth check & room bootstrap (Atomic)
  useEffect(() => {
    let isMounted = true

    const bootstrap = async () => {
      try {
        const session = await getCurrentUser()
        if (!isMounted) return
        setCurrentUser(session.user)

        const roomsData = await listRooms().catch(() => ({ rooms: [] }))
        if (!isMounted) return
        setUserRooms(roomsData.rooms)

        const activeRooms = roomsData.rooms.filter((r) => r.status === 'active')
        if (activeRooms.length > 0) {
          setActiveRoomId(activeRooms[0].roomId.publicId)
          setIsLoadingRoom(true)
        }
        setAuthStatus('ready')
      } catch {
        if (isMounted) {
          setAuthStatus('loggedOut')
        }
      } finally {
        if (isMounted) {
          setIsBootstrapping(false)
        }
      }
    }

    void bootstrap()
    return () => {
      isMounted = false
    }
  }, [])

  // 3. Polling for pending approval when user has no active rooms but has pending ones
  useEffect(() => {
    if (authStatus !== 'ready' || !currentUser || activeRoomId) return
    const hasPending = userRooms.some((r) => r.status === 'pending')
    if (!hasPending) return

    const timer = setInterval(() => {
      void listRooms()
        .then((result) => {
          setUserRooms(result.rooms)
          const activeRooms = result.rooms.filter((r) => r.status === 'active')
          if (activeRooms.length > 0) {
            setActiveRoomId(activeRooms[0].roomId.publicId)
            showToast('Room approved! Welcome to the ledger.')
          }
        })
        .catch(() => {})
    }, 4000)

    return () => clearInterval(timer)
  }, [authStatus, currentUser, activeRoomId, userRooms])

  // 4. Load active room details whenever activeRoomId changes
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
        setRoomContext({
          id: roomData.room.publicId,
          name: roomData.room.name,
          recoveryQuestion: roomData.room.recoveryQuestion,
          dissolveRequest: roomData.room.dissolveRequest,
        })

        const loadedMembers: RoomMember[] = roomData.members.map((m) => ({
          id: m.userId._id,
          membershipId: m._id,
          name: m.userId.displayName,
          role: m.role,
          status: m.status,
        }))
        setRoomMembers(loadedMembers)

        // Pending join requests
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

        // Pending payment settlements
        const allPendingPayments = balanceData.pendingPayments || []
        const incoming = allPendingPayments.filter((p) => {
          const toId = typeof p.toUserId === 'object' && p.toUserId !== null ? p.toUserId._id : String(p.toUserId)
          return toId === currentUser.id
        })
        const outgoing = allPendingPayments.filter((p) => {
          const fromId = typeof p.fromUserId === 'object' && p.fromUserId !== null ? p.fromUserId._id : String(p.fromUserId)
          return fromId === currentUser.id
        })
        setIncomingPayments(incoming)
        setOutgoingPayments(outgoing)

        // Member names map
        const memberNameMap = new Map(loadedMembers.map((m) => [m.id, m.name]))

        // Balances & Suggestions
        const outSuggestions = balanceData.suggestions.filter((s) => s.fromUserId === currentUser.id)
        const inSuggestions = balanceData.suggestions.filter((s) => s.toUserId === currentUser.id)

        const mappedNeedToPay: PaymentRow[] = outSuggestions.map((s) => ({
          id: s.toUserId,
          name: memberNameMap.get(s.toUserId) ?? 'Roommate',
          amount: s.amountPaise / 100,
        }))

        const mappedNeedToReceive: PaymentRow[] = inSuggestions.map((s) => ({
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
        const validExpenses = expenseData.expenses.filter((e) => !e.voidedAt).map(toUiExpense)
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

      setRoomContext({
        id: roomData.room.publicId,
        name: roomData.room.name,
        recoveryQuestion: roomData.room.recoveryQuestion,
        dissolveRequest: roomData.room.dissolveRequest,
      })

      const loadedMembers: RoomMember[] = roomData.members.map((m) => ({
        id: m.userId._id,
        membershipId: m._id,
        name: m.userId.displayName,
        role: m.role,
        status: m.status,
      }))
      setRoomMembers(loadedMembers)

      const memberNameMap = new Map(loadedMembers.map((m) => [m.id, m.name]))
      const outSuggestions = balanceData.suggestions.filter((s) => s.fromUserId === currentUser.id)
      const inSuggestions = balanceData.suggestions.filter((s) => s.toUserId === currentUser.id)

      const mappedNeedToPay: PaymentRow[] = outSuggestions.map((s) => ({
        id: s.toUserId,
        name: memberNameMap.get(s.toUserId) ?? 'Roommate',
        amount: s.amountPaise / 100,
      }))

      const mappedNeedToReceive: PaymentRow[] = inSuggestions.map((s) => ({
        id: s.fromUserId,
        name: memberNameMap.get(s.fromUserId) ?? 'Roommate',
        amount: s.amountPaise / 100,
      }))

      setNeedToPay(mappedNeedToPay)
      setNeedToReceive(mappedNeedToReceive)

      if (mappedNeedToPay.length > 0) {
        setPaymentTarget(mappedNeedToPay[0])
      }

      const allPendingPayments = balanceData.pendingPayments || []
      setIncomingPayments(
        allPendingPayments.filter((p) => {
          const toId = typeof p.toUserId === 'object' && p.toUserId !== null ? p.toUserId._id : String(p.toUserId)
          return toId === currentUser.id
        })
      )
      setOutgoingPayments(
        allPendingPayments.filter((p) => {
          const fromId = typeof p.fromUserId === 'object' && p.fromUserId !== null ? p.fromUserId._id : String(p.fromUserId)
          return fromId === currentUser.id
        })
      )

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

  const handleManualCheckApproval = async () => {
    setIsCheckingApproval(true)
    try {
      const res = await listRooms()
      setUserRooms(res.rooms)
      const active = res.rooms.filter((r) => r.status === 'active')
      if (active.length > 0) {
        setActiveRoomId(active[0].roomId.publicId)
        showToast('Approved! Welcome to the ledger.')
      } else {
        showToast('Request is still pending admin approval.')
      }
    } catch {
      showToast('Could not reach server to check status.')
    } finally {
      setIsCheckingApproval(false)
    }
  }

  // Create room from First Page
  const handleCreateRoomFirstPage = async ({
    displayName,
    roomName,
    recoveryPassword,
    recoveryQuestion,
  }: {
    displayName: string
    roomName: string
    recoveryPassword?: string
    recoveryQuestion?: string
  }) => {
    setLoginError('')
    setIsLoadingRoom(true)
    try {
      const session = await createSession(displayName)
      const res = await createRoom(roomName, recoveryPassword, recoveryQuestion)
      const newRoom = res.room
      showToast(`Created room "${newRoom.name}"`)

      const updatedRooms = await listRooms()
      setUserRooms(updatedRooms.rooms)
      setActiveRoomId(newRoom.publicId)
      setCurrentUser(session.user)
      setAuthStatus('ready')
    } catch (err: unknown) {
      setIsLoadingRoom(false)
      const msg = err instanceof Error ? err.message : 'Could not create room'
      setLoginError(msg)
      throw err
    }
  }

  // Join room from First Page
  const handleJoinRoomFirstPage = async ({
    displayName,
    roomId,
  }: {
    displayName: string
    roomId: string
  }) => {
    setLoginError('')
    setIsLoadingRoom(true)
    try {
      const session = await createSession(displayName)
      const joinRes = await joinRoom(roomId)

      const effectiveUser = joinRes.user || session.user
      setCurrentUser(effectiveUser)

      const updatedRooms = await listRooms()
      setUserRooms(updatedRooms.rooms)
      const active = updatedRooms.rooms.filter((r) => r.status === 'active')

      if (active.length > 0) {
        setActiveRoomId(active[0].roomId.publicId)
        if (joinRes.reclaimed) {
          showToast(`Welcome back, ${effectiveUser.displayName}! Reconnected to room.`)
        } else {
          showToast(`Joined room ${roomId}`)
        }
      } else {
        setActiveRoomId(null)
        setRoomContext(null)
        showToast(`Join request submitted for room ${roomId}`)
      }
      setAuthStatus('ready')
    } catch (err: unknown) {
      setIsLoadingRoom(false)
      const msg = err instanceof Error ? err.message : 'Could not join room'
      setLoginError(msg)
      throw err
    }
  }

  // Recover room from First Page
  const handleRecoverRoomFirstPage = async ({
    displayName,
    roomId,
    recoveryPassword,
  }: {
    displayName: string
    roomId: string
    recoveryPassword: string
  }) => {
    setLoginError('')
    setIsLoadingRoom(true)
    try {
      const session = await createSession(displayName)
      const res = await recoverRoom(roomId, recoveryPassword)
      showToast(`Room "${res.room.name}" recovered! Admin access granted.`)

      const updatedRooms = await listRooms()
      setUserRooms(updatedRooms.rooms)
      setActiveRoomId(res.room.publicId)
      setCurrentUser(session.user)
      setAuthStatus('ready')
    } catch (err: unknown) {
      setIsLoadingRoom(false)
      const msg = err instanceof Error ? err.message : 'Could not recover room'
      setLoginError(msg)
      throw err
    }
  }

  const handleLogout = async () => {
    try {
      await logout()
    } catch {
      // Ignore
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
      showToast('Could not add expense. Check details and retry.')
    }
  }

  const handleEditExpense = async (draft: {
    description: string
    amountPaise: number
    participantIds: string[]
  }) => {
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
      showToast('Could not load history.')
    }
  }

  const handleDecideRequest = async (requestId: string, action: 'approve' | 'reject') => {
    if (!roomContext) return
    try {
      await decideJoinRequest(roomContext.id, requestId, action)
      setJoinRequests((curr) => curr.filter((r) => r.id !== requestId))
      await refreshRoomData()
      showToast(action === 'approve' ? 'Roommate approved' : 'Join request declined')
    } catch {
      showToast('Could not update request.')
    }
  }

  const handleDecidePayment = async (paymentId: string, action: 'approve' | 'reject') => {
    if (!roomContext) return
    try {
      await decidePayment(roomContext.id, paymentId, action)
      showToast(action === 'approve' ? 'Payment confirmed! Balances updated.' : 'Payment declined.')
      await refreshRoomData()
    } catch {
      showToast('Could not update payment status.')
    }
  }

  const handleRemoveMember = async (membershipId: string, memberName: string) => {
    if (!roomContext) return
    try {
      await removeMember(roomContext.id, membershipId)
      showToast(`Removed ${memberName} from room`)
      await refreshRoomData()
    } catch {
      showToast('Could not remove member.')
    }
  }

  const handleCreateRoomInside = async (name: string, recoveryPassword?: string, recoveryQuestion?: string) => {
    try {
      const res = await createRoom(name, recoveryPassword, recoveryQuestion)
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

  const handleJoinRoomInside = async (code: string) => {
    try {
      const res = await joinRoom(code)
      if (res.reclaimed && res.user) {
        setCurrentUser(res.user)
      }
      const updatedRooms = await listRooms()
      setUserRooms(updatedRooms.rooms)
      const active = updatedRooms.rooms.filter((r) => r.status === 'active')
      if (active.some((r) => r.roomId?.publicId === code)) {
        setActiveRoomId(code)
        showToast(res.reclaimed ? 'Reconnected to room!' : 'Room active!')
      } else {
        showToast(`Join request submitted for room ${code}`)
      }
      setOverlay(null)
    } catch {
      showToast('Could not find room with that ID.')
    }
  }

  const handleLeaveRoom = async () => {
    if (!roomContext) return
    try {
      const res = await leaveRoom(roomContext.id)
      setOverlay(null)
      if (res.requiresApproval) {
        showToast('Dissolution request submitted. Waiting for other members to approve.')
        await refreshRoomData()
      } else {
        showToast(`You left ${roomContext.name}`)
        const updatedRooms = await listRooms()
        setUserRooms(updatedRooms.rooms)
        const remainingActive = updatedRooms.rooms.filter((r) => r.status === 'active')
        if (remainingActive.length > 0) {
          setActiveRoomId(remainingActive[0].roomId.publicId)
        } else {
          setActiveRoomId(null)
          setRoomContext(null)
        }
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
      link.download = `${roomContext.name.toLowerCase().replace(/\s+/g, '-')}-ledger.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      showToast('PDF summary downloaded')
    } catch {
      showToast('Failed to download PDF')
    }
  }

  // 1. Initial Loading State
  if (authStatus === 'checking' || isBootstrapping || (isLoadingRoom && activeRoomId && !roomContext)) {
    return (
      <div className="modern-splash">
        <div className="modern-splash-card">
          <div className="modern-spinner" />
          <p>{activeRoomId ? 'Loading ledger...' : 'Connecting to FinLit...'}</p>
        </div>
      </div>
    )
  }

  // 2. Logged-out / First Page
  if (authStatus !== 'ready' || !currentUser) {
    return (
      <FirstPage
        error={loginError}
        onCreateRoom={handleCreateRoomFirstPage}
        onJoinRoom={handleJoinRoomFirstPage}
        onRecoverRoom={handleRecoverRoomFirstPage}
      />
    )
  }

  // 3. User is logged in but has no active rooms
  if (!roomContext && !isLoadingRoom) {
    const pendingMemberships = userRooms.filter((r) => r.status === 'pending')

    if (pendingMemberships.length > 0) {
      return (
        <PendingApprovalView
          currentUser={currentUser}
          pendingRooms={pendingMemberships}
          isChecking={isCheckingApproval}
          onCheckStatus={handleManualCheckApproval}
          onOpenRooms={() => setOverlay('rooms')}
          onLogout={handleLogout}
        />
      )
    }

    return (
      <FirstPage
        error={loginError}
        initialName={currentUser.displayName}
        onCreateRoom={handleCreateRoomFirstPage}
        onJoinRoom={handleJoinRoomFirstPage}
        onRecoverRoom={handleRecoverRoomFirstPage}
      />
    )
  }

  // 4. Authenticated & Active Room View
  const activeMembers = roomMembers.filter((m) => m.status === 'active')
  const currentMember = roomMembers.find((m) => m.id === currentUser.id)
  const isRoomAdmin = currentMember?.role === 'admin'

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView('home')} aria-label="Go to home">
          <span className="brand-logo">fl</span>
          <div className="brand-title">
            <strong>FinLit</strong>
            <small>{roomContext?.name || 'Ledger'}</small>
          </div>
        </button>

        <nav className="desktop-nav" aria-label="Desktop navigation">
          <NavButton active={view === 'home'} label="Ledger" onClick={() => setView('home')} />
          <NavButton active={view === 'activity'} label="Activity" onClick={() => setView('activity')} />
          <NavButton
            active={view === 'room'}
            label={`Roommates (${activeMembers.length})${joinRequests.length > 0 ? ' •' : ''}`}
            onClick={() => setView('room')}
          />
          <button className="btn-primary desktop-add-btn" onClick={() => setOverlay('add')}>
            + Add Expense
          </button>
        </nav>

        <button
          className="user-avatar-badge clickable"
          onClick={() => setOverlay('rooms')}
          aria-label="Account and rooms"
          title={`Signed in as ${currentUser.displayName}`}
        >
          <span className="avatar-disc">{currentUser.displayName[0]?.toUpperCase()}</span>
          <span className="user-label">{currentUser.displayName}</span>
          <span className="status-dot" />
        </button>
      </header>

      <main className="main-content">
        {isLoadingRoom ? (
          <div className="loading-state">
            <div className="modern-spinner" />
            <p>Loading {roomContext?.name || 'room'}...</p>
          </div>
        ) : (
          <>
            {view === 'home' && roomContext && (
              <Home
                room={roomContext}
                memberCount={activeMembers.length}
                isAdmin={isRoomAdmin}
                expenses={expenses}
                needToPay={needToPay}
                needToReceive={needToReceive}
                summary={summary}
                joinRequests={joinRequests}
                incomingPayments={incomingPayments}
                outgoingPayments={outgoingPayments}
                onApproveRequest={(id) => void handleDecideRequest(id, 'approve')}
                onRejectRequest={(id) => void handleDecideRequest(id, 'reject')}
                onApprovePayment={(id) => void handleDecidePayment(id, 'approve')}
                onRejectPayment={(id) => void handleDecidePayment(id, 'reject')}
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
                onToast={showToast}
              />
            )}
            {view === 'activity' && <Activity events={activity} />}
            {view === 'room' && roomContext && (
              <Room
                room={roomContext}
                members={roomMembers}
                currentUserId={currentUser.id}
                isAdmin={isRoomAdmin}
                requests={joinRequests}
                onRequest={handleDecideRequest}
                onRemoveMember={handleRemoveMember}
                onLeave={() => setOverlay('leave')}
                onToast={showToast}
              />
            )}
          </>
        )}
      </main>

      {/* MOBILE BOTTOM NAV */}
      <nav className="bottom-nav" aria-label="Primary navigation">
        <NavButton active={view === 'home'} label="Ledger" onClick={() => setView('home')} />
        <button className="mobile-add-btn" onClick={() => setOverlay('add')} aria-label="Add expense">
          +
        </button>
        <NavButton active={view === 'activity'} label="Activity" onClick={() => setView('activity')} />
        <NavButton
          active={view === 'room'}
          label={`Room${joinRequests.length > 0 ? ' •' : ''}`}
          onClick={() => setView('room')}
        />
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
          currentUserId={currentUser.id}
          onClose={() => setOverlay(null)}
          onEdit={() => setOverlay('edit')}
          onHistory={() => void handleOpenHistory()}
          onVoid={() => void handleVoidExpense(selectedExpense.apiId)}
        />
      )}

      {overlay === 'edit' && selectedExpense && (
        <EditExpense
          expense={selectedExpense}
          availableMembers={activeMembers}
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
          installPrompt={deferredPrompt}
          onInstallHandled={() => setDeferredPrompt(null)}
          onSelectRoom={(code) => {
            startTransition(() => {
              setActiveRoomId(code)
            })
            setOverlay(null)
          }}
          onCreateRoom={handleCreateRoomInside}
          onJoinRoom={handleJoinRoomInside}
          onLogout={() => void handleLogout()}
          onClose={() => setOverlay(null)}
        />
      )}

      {overlay === 'leave' && roomContext && (
        <LeaveRoom
          roomId={roomContext.id}
          roomName={roomContext.name}
          isAdmin={isRoomAdmin}
          memberCount={activeMembers.length}
          outstandingPay={needToPay.reduce((acc, row) => acc + row.amount, 0)}
          outstandingReceive={needToReceive.reduce((acc, row) => acc + row.amount, 0)}
          onClose={() => setOverlay(null)}
          onConfirm={handleLeaveRoom}
        />
      )}

      {toast && <div className="modern-toast" role="status">{toast}</div>}
    </div>
  )
}

// -------------------------------------------------------------------------
// FIRST PAGE / LANDING PAGE (Create Room vs Join Room vs Recover Room)
// -------------------------------------------------------------------------
function FirstPage({
  error,
  initialName = '',
  onCreateRoom,
  onJoinRoom,
  onRecoverRoom,
}: {
  error: string
  initialName?: string
  onCreateRoom: (params: {
    displayName: string
    roomName: string
    recoveryPassword?: string
    recoveryQuestion?: string
  }) => Promise<void>
  onJoinRoom: (params: { displayName: string; roomId: string }) => Promise<void>
  onRecoverRoom: (params: {
    displayName: string
    roomId: string
    recoveryPassword: string
  }) => Promise<void>
}) {
  const [activeTab, setActiveTab] = useState<'create' | 'join' | 'recover'>('create')
  const [name, setName] = useState(initialName)
  const [roomName, setRoomName] = useState('')
  const [roomId, setRoomId] = useState('')
  const [recoveryPassword, setRecoveryPassword] = useState('')
  const [recoveryQuestion, setRecoveryQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [localError, setLocalError] = useState('')

  const handleCreateSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLocalError('')
    if (!name.trim() || !roomName.trim() || loading) return
    setLoading(true)
    try {
      await onCreateRoom({
        displayName: name.trim(),
        roomName: roomName.trim(),
        recoveryPassword: recoveryPassword.trim() || undefined,
        recoveryQuestion: recoveryQuestion.trim() || undefined,
      })
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : 'Could not create room')
    } finally {
      setLoading(false)
    }
  }

  const handleJoinSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLocalError('')
    if (!name.trim() || !roomId.trim() || loading) return
    setLoading(true)
    try {
      await onJoinRoom({ displayName: name.trim(), roomId: roomId.trim().toUpperCase() })
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : 'Could not join room')
    } finally {
      setLoading(false)
    }
  }

  const handleRecoverSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLocalError('')
    if (!name.trim() || !roomId.trim() || !recoveryPassword.trim() || loading) return
    setLoading(true)
    try {
      await onRecoverRoom({
        displayName: name.trim(),
        roomId: roomId.trim().toUpperCase(),
        recoveryPassword: recoveryPassword.trim(),
      })
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : 'Could not recover room')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="landing-layout">
      <div className="landing-card-wrap">
        {/* Header */}
        <div className="landing-header">
          <div className="logo-badge">fl</div>
          <h1>FinLit</h1>
          <p>A clean, calm ledger for roommates to share expenses and settle balances.</p>
        </div>

        {/* Main interactive card */}
        <div className="card landing-card">
          {/* Segmented control */}
          <div className="segmented-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'create'}
              className={`tab-pill ${activeTab === 'create' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('create')
                setLocalError('')
              }}
            >
              Create Room
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'join'}
              className={`tab-pill ${activeTab === 'join' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('join')
                setLocalError('')
              }}
            >
              Join Room
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'recover'}
              className={`tab-pill ${activeTab === 'recover' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('recover')
                setLocalError('')
              }}
            >
              Recover Room
            </button>
          </div>

          {/* Form: Create Room */}
          {activeTab === 'create' && (
            <form className="modern-form" onSubmit={handleCreateSubmit}>
              <div className="form-info-box">
                <strong>Start a new flat</strong>
                <p>You'll be the room admin and can approve flatmates who join.</p>
              </div>

              <div className="input-group">
                <label htmlFor="create-name">Your Name</label>
                <input
                  id="create-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Akshay"
                  autoComplete="name"
                  autoFocus
                  required
                  maxLength={60}
                />
              </div>

              <div className="input-group">
                <label htmlFor="create-room-name">Room / Flat Name</label>
                <input
                  id="create-room-name"
                  type="text"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  placeholder="e.g. Green Park 402"
                  required
                  maxLength={80}
                />
              </div>

              <div className="input-group">
                <label htmlFor="create-recovery-pass">
                  Recovery Password / Key <span className="field-optional">(Optional)</span>
                </label>
                <input
                  id="create-recovery-pass"
                  type="password"
                  value={recoveryPassword}
                  onChange={(e) => setRecoveryPassword(e.target.value)}
                  placeholder="Optional secret key to reclaim admin access"
                  maxLength={80}
                />
              </div>

              <div className="input-group">
                <label htmlFor="create-recovery-question">
                  Security Question / Hint <span className="field-optional">(Optional)</span>
                </label>
                <input
                  id="create-recovery-question"
                  type="text"
                  value={recoveryQuestion}
                  onChange={(e) => setRecoveryQuestion(e.target.value)}
                  placeholder="e.g. Secret code or flat nickname"
                  maxLength={120}
                />
              </div>

              <button className="btn-primary submit-btn" type="submit" disabled={loading}>
                {loading ? 'Creating room...' : 'Create Room & Enter →'}
              </button>
            </form>
          )}

          {/* Form: Join Room */}
          {activeTab === 'join' && (
            <form className="modern-form" onSubmit={handleJoinSubmit}>
              <div className="form-info-box notice">
                <div className="badge-line">
                  <span className="pill-badge dark">Admin Approval Required</span>
                </div>
                <p>Entering a Room ID sends a request to the flat admin. You'll get access once approved.</p>
              </div>

              <div className="input-group">
                <label htmlFor="join-name">Your Name</label>
                <input
                  id="join-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Rahul"
                  autoComplete="name"
                  autoFocus
                  required
                  maxLength={60}
                />
              </div>

              <div className="input-group">
                <label htmlFor="join-room-id">Room ID Code</label>
                <input
                  id="join-room-id"
                  type="text"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                  placeholder="e.g. 8278F02E"
                  className="mono-code-input"
                  required
                  maxLength={12}
                />
              </div>

              <button className="btn-primary submit-btn" type="submit" disabled={loading}>
                {loading ? 'Submitting request...' : 'Request to Join Room →'}
              </button>
            </form>
          )}

          {/* Form: Recover Room */}
          {activeTab === 'recover' && (
            <form className="modern-form" onSubmit={handleRecoverSubmit}>
              <div className="form-info-box notice">
                <div className="badge-line">
                  <span className="pill-badge dark">Reclaim Admin Access</span>
                </div>
                <p>
                  Accidentally left or lost admin access? Enter the room ID and your recovery password to restore admin rights.
                </p>
              </div>

              <div className="input-group">
                <label htmlFor="recover-name">Your Name</label>
                <input
                  id="recover-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Akshay"
                  autoComplete="name"
                  autoFocus
                  required
                  maxLength={60}
                />
              </div>

              <div className="input-group">
                <label htmlFor="recover-room-id">Room ID Code</label>
                <input
                  id="recover-room-id"
                  type="text"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                  placeholder="e.g. 8278F02E"
                  className="mono-code-input"
                  required
                  maxLength={12}
                />
              </div>

              <div className="input-group">
                <label htmlFor="recover-password">Recovery Password / Security Answer</label>
                <input
                  id="recover-password"
                  type="password"
                  value={recoveryPassword}
                  onChange={(e) => setRecoveryPassword(e.target.value)}
                  placeholder="Enter the recovery key set at creation"
                  required
                  maxLength={80}
                />
              </div>

              <button className="btn-primary submit-btn" type="submit" disabled={loading}>
                {loading ? 'Recovering room...' : 'Recover Room & Claim Admin →'}
              </button>
            </form>
          )}

          {(error || localError) && (
            <div className="form-error-banner" role="alert">
              {error || localError}
            </div>
          )}

          <div className="card-footer-note">
            <small>{apiIsConfigured ? 'Live Backend Connected · Secure Session' : 'Preview Mode'}</small>
          </div>
        </div>
      </div>
    </main>
  )
}
// -------------------------------------------------------------------------
// PENDING APPROVAL VIEW
// -------------------------------------------------------------------------
function PendingApprovalView({
  currentUser,
  pendingRooms,
  isChecking,
  onCheckStatus,
  onOpenRooms,
  onLogout,
}: {
  currentUser: CurrentUser
  pendingRooms: ApiRoomMembership[]
  isChecking: boolean
  onCheckStatus: () => Promise<void>
  onOpenRooms: () => void
  onLogout: () => void
}) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-logo">fl</span>
          <div className="brand-title">
            <strong>FinLit</strong>
            <small>Shared Ledger</small>
          </div>
        </div>
        <div className="user-avatar-badge">
          <span className="avatar-disc">{currentUser.displayName[0]?.toUpperCase()}</span>
          <span className="user-label">{currentUser.displayName}</span>
        </div>
      </header>

      <main className="main-content">
        <div className="card status-card">
          <div className="status-pulse-wrap">
            <div className="pulse-circle" />
            <span className="pill-badge">Pending Admin Approval</span>
          </div>

          <h2>Join Request Submitted</h2>
          <p className="subtitle">
            Your request to join has been recorded. The room administrator will need to approve your request before you can access the ledger.
          </p>

          <div className="pending-cards-list">
            {pendingRooms.map((membership) => (
              <div key={membership._id} className="pending-room-card">
                <div>
                  <strong>{membership.roomId?.name || 'Flat Ledger'}</strong>
                  <span className="code-tag">Room ID: {membership.roomId?.publicId}</span>
                </div>
                <span className="pill-badge muted">Under Review</span>
              </div>
            ))}
          </div>

          <div className="auto-poll-note">
            <small>This screen refreshes automatically when approved.</small>
          </div>

          <div className="pending-actions-col">
            <button className="btn-primary" onClick={() => void onCheckStatus()} disabled={isChecking}>
              {isChecking ? 'Checking status...' : 'Check Status Now'}
            </button>
            <div className="secondary-row">
              <button className="btn-secondary" onClick={onOpenRooms}>
                + Create or Join Another Room
              </button>
            </div>
            <button className="ghost-btn" onClick={onLogout}>
              Sign Out
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}

// -------------------------------------------------------------------------
// NAVIGATION BUTTON
// -------------------------------------------------------------------------
function NavButton({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button className={`nav-link ${active ? 'active' : ''}`} onClick={onClick}>
      {label}
    </button>
  )
}

// -------------------------------------------------------------------------
// HOME VIEW
// -------------------------------------------------------------------------
function Home({
  room,
  memberCount,
  isAdmin,
  expenses,
  needToPay,
  needToReceive,
  summary,
  joinRequests,
  incomingPayments,
  outgoingPayments,
  onApproveRequest,
  onRejectRequest,
  onApprovePayment,
  onRejectPayment,
  onAdd,
  onPay,
  onExpense,
  onExport,
  onToast,
}: {
  room: RoomContext
  memberCount: number
  isAdmin: boolean
  expenses: Expense[]
  needToPay: PaymentRow[]
  needToReceive: PaymentRow[]
  summary: ApiSummary
  joinRequests: JoinRequest[]
  incomingPayments: ApiPendingPayment[]
  outgoingPayments: ApiPendingPayment[]
  onApproveRequest: (id: string) => void
  onRejectRequest: (id: string) => void
  onApprovePayment: (id: string) => void
  onRejectPayment: (id: string) => void
  onAdd: () => void
  onPay: (target: PaymentRow) => void
  onExpense: (expense: Expense) => void
  onExport: () => void
  onToast: (msg: string) => void
}) {
  const toPay = needToPay.reduce((total, row) => total + row.amount, 0)
  const toReceive = needToReceive.reduce((total, row) => total + row.amount, 0)
  const balance = toReceive - toPay
  const balanceLabel = balance === 0 ? '₹0' : `${balance > 0 ? '+' : '-'}${money(Math.abs(balance))}`

  return (
    <div className="home-stack">
      {/* ROOM HEADER */}
      <section className="room-masthead">
        <div className="room-info">
          <h1>{room.name}</h1>
          <div className="room-tags-row">
            <span className="pill-badge muted">{memberCount} {memberCount === 1 ? 'roommate' : 'roommates'}</span>
            <button
              className="code-pill-btn"
              onClick={() => {
                void navigator.clipboard?.writeText(room.id)
                onToast(`Copied Room ID: ${room.id}`)
              }}
              title="Click to copy Room ID"
            >
              <span>Room ID: <strong>{room.id}</strong></span>
              <span className="copy-icon">📋</span>
            </button>
          </div>
        </div>

        <button className="btn-primary header-add-btn" onClick={onAdd}>
          + Add Expense
        </button>
      </section>

      {/* ADMIN JOIN REQUESTS BANNER */}
      {isAdmin && joinRequests.length > 0 && (
        <section className="alert-banner">
          <div className="alert-left">
            <span className="pill-badge dark">Roommate Join Request</span>
            <strong>{joinRequests.length} pending join {joinRequests.length === 1 ? 'request' : 'requests'}</strong>
            <p>{joinRequests.map((r) => r.name).join(', ')} requested to join this room.</p>
          </div>
          <div className="alert-actions">
            {joinRequests.map((req) => (
              <div key={req.id} className="req-action-pill">
                <span>{req.name}</span>
                <button className="btn-approve" onClick={() => onApproveRequest(req.id)}>
                  Approve
                </button>
                <button className="btn-reject" onClick={() => onRejectRequest(req.id)}>
                  Decline
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* INCOMING SETTLEMENT PAYMENT CONFIRMATION BANNER */}
      {incomingPayments.length > 0 && (
        <section className="alert-banner payment-alert">
          <div className="alert-left">
            <span className="pill-badge dark">Payment Received — Approval Needed</span>
            <strong>{incomingPayments.length} pending payment settlement {incomingPayments.length === 1 ? 'confirmation' : 'confirmations'}</strong>
            <p>Roommates recorded payments to you. Confirm below once you have received the money.</p>
          </div>
          <div className="alert-actions">
            {incomingPayments.map((pay) => {
              const fromName =
                typeof pay.fromUserId === 'object' && pay.fromUserId !== null
                  ? pay.fromUserId.displayName
                  : 'Roommate'
              return (
                <div key={pay._id} className="req-action-pill payment-pill">
                  <span>{fromName} paid <strong>{money(pay.amountPaise / 100)}</strong></span>
                  <button className="btn-approve" onClick={() => onApprovePayment(pay._id)}>
                    ✓ Confirm Received
                  </button>
                  <button className="btn-reject" onClick={() => onRejectPayment(pay._id)}>
                    ✕ Decline
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* OUTGOING PENDING SETTLEMENT STATUS */}
      {outgoingPayments.length > 0 && (
        <div className="pending-settlement-notice">
          <span className="notice-icon">⏳</span>
          <div>
            <strong>Pending Payment Confirmation ({outgoingPayments.length})</strong>
            <p>
              {outgoingPayments
                .map((p) => {
                  const toName =
                    typeof p.toUserId === 'object' && p.toUserId !== null
                      ? p.toUserId.displayName
                      : 'Roommate'
                  return `Payment of ${money(p.amountPaise / 100)} to ${toName}`
                })
                .join(', ')}{' '}
              — waiting for receiver to confirm before balances update.
            </p>
          </div>
        </div>
      )}

      {/* NET BALANCE HERO */}
      <section className="card hero-balance-card">
        <div className="hero-top">
          <span className="eyebrow-text">Your Net Balance</span>
          <span className="period-label">{summary.month || 'Current Month'}</span>
        </div>

        <div className={`hero-amount ${balance > 0 ? 'positive' : balance < 0 ? 'negative' : ''}`}>
          {balanceLabel}
        </div>

        <div className="hero-dues-summary">
          <div className="due-summary-col">
            <span className="label">You need to pay</span>
            <strong className="val">{money(toPay)}</strong>
          </div>
          <div className="col-divider" />
          <div className="due-summary-col">
            <span className="label">Others owe you</span>
            <strong className="val">{money(toReceive)}</strong>
          </div>
        </div>
      </section>

      {/* DUES 2-COLUMN GRID */}
      <section className="dues-grid">
        <DuesCard
          title="You Need to Pay"
          rows={needToPay}
          emptyText="You're all settled up! No payments due."
          action="Pay Back"
          onAction={(row) => onPay(row)}
        />
        <DuesCard
          title="Others Owe You"
          rows={needToReceive}
          emptyText="Nobody owes you in this room right now."
        />
      </section>

      {/* MONTHLY LEDGER SUMMARY */}
      <section className="card summary-card">
        <div className="card-header-row">
          <div>
            <h3>Monthly Breakdown</h3>
            <p className="card-sub">Your share versus room spending</p>
          </div>
          <button className="btn-secondary sm" onClick={onExport}>
            Export PDF
          </button>
        </div>

        <div className="summary-metrics-grid">
          <div className="metric-box">
            <span>You Paid</span>
            <strong>{money(summary.youPaidPaise / 100)}</strong>
          </div>
          <div className="metric-box">
            <span>Paid for Others</span>
            <strong>{money(summary.paidForOthersPaise / 100)}</strong>
          </div>
          <div className="metric-box">
            <span>Your Share</span>
            <strong>{money(summary.yourSharePaise / 100)}</strong>
          </div>
          <div className="metric-box">
            <span>Room Total</span>
            <strong>{money(summary.roomSpentPaise / 100)}</strong>
          </div>
        </div>
      </section>

      {/* RECENT EXPENSES */}
      <section className="card expenses-card">
        <div className="card-header-row">
          <div>
            <h3>Recent Expenses</h3>
            <p className="card-sub">{expenses.length} records logged</p>
          </div>
        </div>

        {expenses.length > 0 ? (
          <div className="expenses-list">
            {expenses.map((expense) => (
              <button
                key={expense.id}
                className="expense-item"
                onClick={() => onExpense(expense)}
              >
                <div className="expense-left">
                  <div className="expense-icon-circle">₹</div>
                  <div className="expense-text">
                    <strong>{expense.title}</strong>
                    <small>Paid by {expense.paidBy} · {expense.date}</small>
                  </div>
                </div>

                <div className="expense-right">
                  <strong>{money(expense.amount)}</strong>
                  {expense.edited && <span className="pill-badge sm">Edited</span>}
                  <span className="chevron">›</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-state-box">
            <p>No expenses recorded in this flat yet.</p>
            <button className="btn-secondary sm" onClick={onAdd} style={{ marginTop: 8 }}>
              + Add First Expense
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

function DuesCard({
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
    <div className="card dues-card">
      <div className="dues-card-top">
        <h3>{title}</h3>
        <span className="pill-badge sm">{rows.length}</span>
      </div>

      {rows.length > 0 ? (
        <div className="dues-items-list">
          {rows.map((row) => (
            <div key={row.id} className="due-row">
              <div className="due-user">
                <span className="avatar-disc sm">{row.name[0]?.toUpperCase()}</span>
                <strong>{row.name}</strong>
              </div>
              <div className="due-right">
                <strong className="due-val">{money(row.amount)}</strong>
                {action && (
                  <button className="btn-primary xs" onClick={() => onAction?.(row)}>
                    {action}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-muted-text">{emptyText}</p>
      )}
    </div>
  )
}

// -------------------------------------------------------------------------
// ACTIVITY VIEW
// -------------------------------------------------------------------------
function Activity({ events }: { events: ApiActivity[] }) {
  return (
    <div className="activity-stack">
      <div className="page-title-row">
        <div>
          <h1>Activity</h1>
          <p className="subtitle">Real-time log of expenses, payments, and member updates.</p>
        </div>
      </div>

      <div className="card activity-card">
        {events.length > 0 ? (
          <div className="timeline-flow">
            {events.map((event) => {
              const parsed = formatActivity(event)
              return (
                <div key={event._id} className="timeline-card">
                  <div className="timeline-point" />
                  <div className="timeline-body">
                    <div className="timeline-head">
                      <strong>{parsed.title}</strong>
                      <small>
                        {new Date(event.createdAt).toLocaleString('en-IN', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </small>
                    </div>
                    <p>{parsed.detail}</p>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="empty-state-box">
            <p>No activity yet. Updates will appear here as roommates record expenses.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function formatActivity(event: ApiActivity): { title: string; detail: string } {
  const actor = event.actorId?.displayName ?? 'A roommate'
  const action = event.action

  if (action === 'expense.created') {
    const desc = (event.newValues?.description as string) || 'Shared expense'
    const paise = (event.newValues?.amountPaise as number) || 0
    return { title: `${actor} recorded an expense`, detail: `"${desc}" · ₹${(paise / 100).toLocaleString('en-IN')}` }
  }
  if (action === 'expense.updated') {
    const desc = (event.newValues?.description as string) || (event.previousValues?.description as string) || 'Expense'
    const paise = (event.newValues?.amountPaise as number) || (event.previousValues?.amountPaise as number) || 0
    const moneyStr = paise ? ` · ₹${(paise / 100).toLocaleString('en-IN')}` : ''
    return { title: `${actor} updated an expense`, detail: `Modified "${desc}"${moneyStr}` }
  }
  if (action === 'expense.voided') {
    const desc = (event.previousValues?.description as string) || (event.newValues?.description as string) || 'Shared expense'
    const paise = (event.previousValues?.amountPaise as number) || (event.newValues?.amountPaise as number) || 0
    const moneyStr = paise ? ` · ₹${(paise / 100).toLocaleString('en-IN')}` : ''
    return { title: `${actor} voided an expense`, detail: `Voided "${desc}"${moneyStr}` }
  }
  if (action === 'payment.requested' || action === 'payment.created') {
    const paise = (event.newValues?.amountPaise as number) || 0
    return { title: `${actor} recorded a payment`, detail: `Settlement of ₹${(paise / 100).toLocaleString('en-IN')} (Pending receiver confirmation)` }
  }
  if (action === 'payment.confirmed') {
    const paise = (event.newValues?.amountPaise as number) || 0
    return { title: `${actor} confirmed a payment`, detail: `Settlement of ₹${(paise / 100).toLocaleString('en-IN')} confirmed · Completed` }
  }
  if (action === 'payment.rejected') {
    const paise = (event.newValues?.amountPaise as number) || 0
    return { title: `${actor} declined a payment`, detail: `Settlement record of ₹${(paise / 100).toLocaleString('en-IN')} declined` }
  }
  if (action === 'membership.approve') {
    return { title: `${actor} approved a new roommate`, detail: 'New member joined the room' }
  }
  if (action === 'membership.reject') {
    return { title: `${actor} declined a join request`, detail: 'Request dismissed' }
  }
  if (action === 'membership.left') {
    return { title: `${actor} left the room`, detail: 'Membership archived' }
  }
  if (action === 'membership.removed') {
    return { title: `${actor} removed a member`, detail: 'Roommate removed from room roster' }
  }
  if (action === 'room.dissolve_requested') {
    return { title: `${actor} requested to dissolve the room`, detail: 'Pending roommate consensus' }
  }
  if (action === 'room.dissolved') {
    return { title: `${actor} approved room dissolution`, detail: 'Room successfully dissolved' }
  }
  if (action === 'room.recovered') {
    return { title: `${actor} recovered the room`, detail: 'Admin rights reclaimed via recovery key' }
  }

  return { title: `${actor} updated the room`, detail: action.replace('.', ' ') }
}

// -------------------------------------------------------------------------
// ROOM & MEMBERS VIEW
// -------------------------------------------------------------------------
function Room({
  room,
  members,
  currentUserId,
  isAdmin,
  requests,
  onRequest,
  onRemoveMember,
  onLeave,
  onToast,
}: {
  room: RoomContext
  members: RoomMember[]
  currentUserId: string
  isAdmin: boolean
  requests: JoinRequest[]
  onRequest: (requestId: string, action: 'approve' | 'reject') => Promise<void>
  onRemoveMember: (membershipId: string, memberName: string) => Promise<void>
  onLeave: () => void
  onToast: (message: string) => void
}) {
  const activeMembers = members.filter((m) => m.status === 'active')
  const formerMembers = members.filter((m) => m.status === 'left')

  return (
    <div className="room-stack">
      <div className="page-title-row">
        <div>
          <h1>{room.name}</h1>
          <p className="subtitle">Room settings and member roster.</p>
        </div>

        <button
          className="code-pill-btn"
          onClick={() => {
            void navigator.clipboard?.writeText(room.id)
            onToast(`Room ID copied: ${room.id}`)
          }}
        >
          <span>Room Code: <strong>{room.id}</strong></span>
          <span className="copy-icon">📋</span>
        </button>
      </div>

      {/* PENDING REQUESTS */}
      {isAdmin && requests.length > 0 && (
        <section className="card requests-card">
          <div className="card-header-row">
            <div>
              <h3>Pending Join Requests</h3>
              <p className="card-sub">{requests.length} roommates waiting for approval</p>
            </div>
          </div>

          <div className="requests-list">
            {requests.map((request) => (
              <div key={request.id} className="request-item">
                <strong>{request.name}</strong>
                <div className="btn-pair">
                  <button className="btn-approve" onClick={() => void onRequest(request.id, 'approve')}>
                    Approve
                  </button>
                  <button className="btn-reject" onClick={() => void onRequest(request.id, 'reject')}>
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ROSTER */}
      <section className="card roster-card">
        <div className="card-header-row">
          <div>
            <h3>Active Roommates</h3>
            <p className="card-sub">{activeMembers.length} members sharing expenses</p>
          </div>
        </div>

        <div className="roster-list">
          {activeMembers.map((member) => {
            const isMe = member.id === currentUserId
            const isMemberAdmin = member.role === 'admin'
            return (
              <div key={member.id} className="roster-item">
                <div className="roster-user">
                  <span className="avatar-disc">{member.name[0]?.toUpperCase()}</span>
                  <div>
                    <strong>{member.name}</strong>
                    {isMe && <span className="you-label">(You)</span>}
                  </div>
                </div>

                <div className="roster-actions-row">
                  {isMemberAdmin ? (
                    <span className="pill-badge dark">Admin</span>
                  ) : (
                    <span className="pill-badge muted">Member</span>
                  )}
                  {isAdmin && !isMe && (
                    <button
                      className="ghost-btn danger sm"
                      onClick={() => {
                        if (window.confirm(`Are you sure you want to remove ${member.name} from the room?`)) {
                          void onRemoveMember(member.membershipId, member.name)
                        }
                      }}
                      title={`Remove ${member.name} from room`}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* FORMER MEMBERS */}
      {formerMembers.length > 0 && (
        <section className="card former-card">
          <div className="card-header-row">
            <div>
              <h3>Former Roommates</h3>
              <p className="card-sub">{formerMembers.length} historical records preserved</p>
            </div>
          </div>

          <div className="roster-list">
            {formerMembers.map((member) => (
              <div key={member.id} className="roster-item muted">
                <div className="roster-user">
                  <span className="avatar-disc muted">{member.name[0]?.toUpperCase()}</span>
                  <strong>{member.name}</strong>
                </div>
                <small>Left room</small>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="leave-room-box">
        <button className="ghost-btn danger" onClick={onLeave}>
          {isAdmin && activeMembers.length > 1 ? 'Leave / Dissolve Room' : 'Leave Room'}
        </button>
      </div>
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

  const selectAll = () => setSelectedMemberIds(availableMembers.map((m) => m.id))

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
    <Modal title="Add Expense" onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <div className="amount-input-card">
          <label htmlFor="expense-amount">Amount</label>
          <div className="amount-row">
            <span className="currency-mark">₹</span>
            <input
              id="expense-amount"
              type="number"
              step="any"
              min="0.01"
              inputMode="decimal"
              placeholder="0"
              autoFocus
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </div>

        <div className="input-group">
          <label htmlFor="expense-desc">Description (Optional)</label>
          <input
            id="expense-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Groceries, Electricity, WiFi"
            maxLength={120}
          />
        </div>

        <div className="input-group">
          <label htmlFor="payer-select">Paid By</label>
          <select
            id="payer-select"
            className="modern-select"
            value={payerId}
            onChange={(e) => setPayerId(e.target.value)}
          >
            {availableMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} {m.id === currentUserId ? '(You)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="split-selection-block">
          <div className="split-top-row">
            <label>Split Between ({selectedMemberIds.length})</label>
            <button type="button" className="ghost-btn sm" onClick={selectAll}>
              Select All
            </button>
          </div>

          <div className="member-chips-wrap">
            {availableMembers.map((member) => {
              const selected = selectedMemberIds.includes(member.id)
              return (
                <button
                  type="button"
                  key={member.id}
                  className={`member-chip ${selected ? 'active' : ''}`}
                  onClick={() => toggleMember(member.id)}
                >
                  <span className="check-disc">{selected ? '✓' : ''}</span>
                  <span>{member.name}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="split-preview-box">
          <span>Split Preview</span>
          <strong>{splitLabel}</strong>
        </div>

        <button
          className="btn-primary submit-btn"
          type="submit"
          disabled={submitting || !numAmount || splitCount === 0}
        >
          {submitting ? 'Adding...' : 'Add Expense →'}
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
  currentUserId,
  onClose,
  onEdit,
  onHistory,
  onVoid,
}: {
  expense: Expense
  currentUserId: string
  onClose: () => void
  onEdit: () => void
  onHistory: () => void
  onVoid: () => void
}) {
  const [confirmVoid, setConfirmVoid] = useState(false)
  const share = expense.amount / expense.participantCount
  const isPayer = currentUserId === expense.payerId

  return (
    <Modal title="Expense Details" onClose={onClose}>
      <div className="details-card-body">
        <div className="details-hero">
          <h2>{expense.title}</h2>
          <div className="details-hero-amount">{money(expense.amount)}</div>
          {expense.edited && <span className="pill-badge sm">Edited</span>}
        </div>

        <div className="details-table">
          <div className="d-row">
            <span>Paid by</span>
            <strong>{expense.paidBy}</strong>
          </div>
          <div className="d-row">
            <span>Split among</span>
            <strong>{expense.participantCount} roommates</strong>
          </div>
          <div className="d-row">
            <span>Per person</span>
            <strong>
              ₹
              {share.toLocaleString('en-IN', {
                minimumFractionDigits: share % 1 ? 2 : 0,
                maximumFractionDigits: 2,
              })}
            </strong>
          </div>
          <div className="d-row">
            <span>Date</span>
            <strong>{expense.date}</strong>
          </div>
        </div>

        <div className="details-actions">
          <button className="btn-secondary" onClick={onEdit}>
            Edit Details & Split
          </button>
          <button className="btn-secondary" onClick={onHistory}>
            Audit History
          </button>
        </div>

        {isPayer && (
          <div className="void-area">
            {confirmVoid ? (
              <div className="confirm-void-box">
                <p>Voiding will cancel this expense of {money(expense.amount)} from all balances.</p>
                <div className="btn-pair">
                  <button className="btn-primary danger" onClick={onVoid}>
                    Confirm Void
                  </button>
                  <button className="btn-secondary" onClick={() => setConfirmVoid(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button className="ghost-btn danger" onClick={() => setConfirmVoid(true)}>
                Void Expense
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

// -------------------------------------------------------------------------
// EDIT EXPENSE MODAL
// -------------------------------------------------------------------------
function EditExpense({
  expense,
  availableMembers,
  onClose,
  onSubmit,
}: {
  expense: Expense
  availableMembers: RoomMember[]
  onClose: () => void
  onSubmit: (draft: {
    description: string
    amountPaise: number
    participantIds: string[]
  }) => Promise<void>
}) {
  const [title, setTitle] = useState(expense.title)
  const [amount, setAmount] = useState(String(expense.amount))
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>(
    expense.participantIds && expense.participantIds.length > 0
      ? expense.participantIds
      : availableMembers.map((m) => m.id)
  )
  const [saving, setSaving] = useState(false)

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

  const selectAll = () => setSelectedMemberIds(availableMembers.map((m) => m.id))

  return (
    <Modal title="Edit Expense" onClose={onClose}>
      <form
        className="modal-form"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!Number(amount) || splitCount === 0 || saving) return
          setSaving(true)
          try {
            await onSubmit({
              description: title.trim() || 'Shared expense',
              amountPaise: Math.round(Number(amount) * 100),
              participantIds: selectedMemberIds,
            })
          } finally {
            setSaving(false)
          }
        }}
      >
        <div className="amount-input-card">
          <label htmlFor="edit-amount">Amount</label>
          <div className="amount-row">
            <span className="currency-mark">₹</span>
            <input
              id="edit-amount"
              type="number"
              step="any"
              min="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="input-group">
          <label htmlFor="edit-title">Description</label>
          <input
            id="edit-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={120}
          />
        </div>

        <div className="split-selection-block">
          <div className="split-top-row">
            <label>Split Between ({selectedMemberIds.length})</label>
            <button type="button" className="ghost-btn sm" onClick={selectAll}>
              Select All
            </button>
          </div>

          <div className="member-chips-wrap">
            {availableMembers.map((member) => {
              const selected = selectedMemberIds.includes(member.id)
              return (
                <button
                  type="button"
                  key={member.id}
                  className={`member-chip ${selected ? 'active' : ''}`}
                  onClick={() => toggleMember(member.id)}
                >
                  <span className="check-disc">{selected ? '✓' : ''}</span>
                  <span>{member.name}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="split-preview-box">
          <span>Updated Split</span>
          <strong>{splitLabel}</strong>
        </div>

        <button className="btn-primary submit-btn" type="submit" disabled={saving || !numAmount || splitCount === 0}>
          {saving ? 'Saving...' : 'Save Changes →'}
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
    <Modal title="Audit History" onClose={onClose}>
      <div className="history-flow">
        {history.length ? (
          history.map((event) => (
            <div className="history-item-row" key={event._id}>
              <strong>
                {event.actorId?.displayName ?? 'A roommate'} {event.action.replace('.', ' ')}
              </strong>
              <small>
                {new Date(event.createdAt).toLocaleString('en-IN', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </small>
            </div>
          ))
        ) : (
          <p className="empty-muted-text">No prior edits recorded.</p>
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
  const [amount, setAmount] = useState(String(target.amount))
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
      onToast(`Payment of ${money(numAmount)} recorded. Sent to ${target.name} for confirmation.`)
    } catch {
      onToast("Couldn't record payment. Amount exceeds balance.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal title={`Pay ${target.name}`} onClose={onClose}>
      <div className="pay-modal-body">
        <div className="pay-hero-card">
          <span>You owe {target.name}</span>
          <strong>{money(target.amount)}</strong>
        </div>

        <div className="form-info-box notice">
          <p>
            <strong>Note:</strong> Once recorded, this settlement payment will require confirmation from{' '}
            <strong>{target.name}</strong> before the ledger balance is updated.
          </p>
        </div>

        {availableTargets.length > 1 && (
          <div className="input-group">
            <label htmlFor="pay-target-select">Recipient</label>
            <select
              id="pay-target-select"
              className="modern-select"
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
          </div>
        )}

        <div className="amount-input-card">
          <label htmlFor="pay-amount">Amount Paid</label>
          <div className="amount-row">
            <span className="currency-mark">₹</span>
            <input
              id="pay-amount"
              type="number"
              step="any"
              max={target.amount}
              min="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </div>

        <div className="remaining-box">
          <span>Remaining after payment</span>
          <strong>{money(remaining)}</strong>
        </div>

        <button
          className="btn-primary submit-btn"
          disabled={numAmount <= 0 || numAmount > target.amount || submitting}
          onClick={() => void submit()}
        >
          {submitting ? 'Recording...' : 'Record Payment →'}
        </button>
      </div>
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
  installPrompt,
  onInstallHandled,
  onSelectRoom,
  onCreateRoom,
  onJoinRoom,
  onLogout,
  onClose,
}: {
  currentUser: CurrentUser
  currentRoomId: string | null
  rooms: ApiRoomMembership[]
  installPrompt: any
  onInstallHandled: () => void
  onSelectRoom: (code: string) => void
  onCreateRoom: (name: string, recoveryPassword?: string, recoveryQuestion?: string) => Promise<void>
  onJoinRoom: (code: string) => Promise<void>
  onLogout: () => void
  onClose: () => void
}) {
  const [roomName, setRoomName] = useState('')
  const [roomId, setRoomId] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [isJoining, setIsJoining] = useState(false)

  const submitCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!roomName.trim() || isCreating) return
    setIsCreating(true)
    try {
      await onCreateRoom(roomName.trim())
      setRoomName('')
    } finally {
      setIsCreating(false)
    }
  }

  const submitJoin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!roomId.trim() || isJoining) return
    setIsJoining(true)
    try {
      await onJoinRoom(roomId.trim().toUpperCase())
      setRoomId('')
    } finally {
      setIsJoining(false)
    }
  }

  return (
    <Modal title="Rooms & Account" onClose={onClose}>
      <div className="account-top">
        <span className="avatar-disc lg">{currentUser.displayName[0]?.toUpperCase()}</span>
        <div>
          <strong>{currentUser.displayName}</strong>
          <small>Signed in</small>
        </div>
      </div>

      <div className="rooms-section">
        <label className="section-label">Your Rooms ({rooms.length})</label>
        <div className="rooms-list">
          {rooms.length > 0 ? (
            rooms.map((membership) => {
              const isCurrent = membership.roomId?.publicId === currentRoomId
              const isPending = membership.status === 'pending'
              return (
                <button
                  key={membership._id}
                  type="button"
                  className={`room-select-btn ${isCurrent ? 'active' : ''} ${isPending ? 'pending' : ''}`}
                  onClick={() => {
                    if (!isPending) onSelectRoom(membership.roomId.publicId)
                  }}
                  disabled={isPending}
                >
                  <div>
                    <strong>{membership.roomId?.name || 'Flat Ledger'}</strong>
                    <small>ID: {membership.roomId?.publicId}</small>
                  </div>
                  <div>
                    {isPending && <span className="pill-badge muted">Pending</span>}
                    {!isPending && isCurrent && <span className="pill-badge dark">Current</span>}
                    {!isPending && !isCurrent && membership.role === 'admin' && (
                      <span className="pill-badge muted">Admin</span>
                    )}
                  </div>
                </button>
              )
            })
          ) : (
            <p className="empty-muted-text">No rooms found.</p>
          )}
        </div>
      </div>

      <div className="quick-actions-forms">
        <form className="inline-action-form" onSubmit={submitCreate}>
          <label htmlFor="create-inline-input">+ Create Another Room</label>
          <div className="form-inline-row">
            <input
              id="create-inline-input"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder="e.g. Vacation Flat"
              required
              maxLength={60}
            />
            <button className="btn-primary sm" type="submit" disabled={isCreating}>
              {isCreating ? '...' : 'Create'}
            </button>
          </div>
        </form>

        <form className="inline-action-form" onSubmit={submitJoin}>
          <label htmlFor="join-inline-input">↳ Join Another Room (Code)</label>
          <div className="form-inline-row">
            <input
              id="join-inline-input"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value.toUpperCase())}
              placeholder="e.g. 8278F02E"
              required
              maxLength={12}
            />
            <button className="btn-primary sm" type="submit" disabled={isJoining}>
              {isJoining ? '...' : 'Request'}
            </button>
          </div>
        </form>
      </div>

      {installPrompt && (
        <div className="install-app-card">
          <div className="install-app-icon">📲</div>
          <div className="install-app-info">
            <strong>Install FinLit App</strong>
            <p>Add to home screen for instant offline access</p>
          </div>
          <button
            type="button"
            className="btn-primary sm install-btn-action"
            onClick={async () => {
              await installPrompt.prompt()
              onInstallHandled()
            }}
          >
            Install
          </button>
        </div>
      )}

      <button className="ghost-btn danger full" onClick={onLogout}>
        Sign Out
      </button>
    </Modal>
  )
}

// -------------------------------------------------------------------------
// LEAVE ROOM MODAL
// -------------------------------------------------------------------------
function LeaveRoom({
  roomName,
  isAdmin,
  memberCount,
  outstandingPay,
  outstandingReceive,
  onClose,
  onConfirm,
}: {
  roomId: string
  roomName: string
  isAdmin: boolean
  memberCount: number
  outstandingPay: number
  outstandingReceive: number
  onClose: () => void
  onConfirm: () => Promise<void>
}) {
  const [leaving, setLeaving] = useState(false)
  const isMultiMemberAdmin = isAdmin && memberCount > 1

  return (
    <Modal title={isMultiMemberAdmin ? 'Dissolve / Leave Room' : 'Leave Room'} onClose={onClose}>
      <div className="leave-modal-body">
        {isMultiMemberAdmin ? (
          <div className="warning-card notice">
            <p>
              <strong>Admin Consensus Required:</strong> Because there are other active members in this flat, leaving or dissolving the room requires approval from the other roommates.
            </p>
            <p style={{ marginTop: 6 }}>
              Clicking below will initiate a dissolution request for other members to vote on.
            </p>
          </div>
        ) : (
          <div className="warning-card">
            {outstandingPay > 0 ? (
              <p>
                You still owe <strong>{money(outstandingPay)}</strong> in this room.
                <br />
                Leaving preserves financial logs.
              </p>
            ) : outstandingReceive > 0 ? (
              <p>
                Roommates owe you <strong>{money(outstandingReceive)}</strong>.
                <br />
                Leaving preserves your transaction records.
              </p>
            ) : (
              <p>
                Your balance in this room is settled (₹0).
                <br />
                Leaving will archive your membership.
              </p>
            )}
          </div>
        )}

        <button
          className="btn-primary danger submit-btn"
          disabled={leaving}
          onClick={async () => {
            setLeaving(true)
            await onConfirm()
          }}
        >
          {leaving
            ? 'Processing...'
            : isMultiMemberAdmin
            ? 'Request Room Dissolution →'
            : `Leave ${roomName}`}
        </button>
        <button className="btn-secondary" onClick={onClose} style={{ width: '100%', marginTop: 8 }}>
          Stay in Room
        </button>
      </div>
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
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <section className="modal-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </section>
    </div>
  )
}

export default App

