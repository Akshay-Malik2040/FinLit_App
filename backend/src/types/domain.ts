export type SplitMethod = 'equal' | 'custom' | 'percentage'
export type MembershipRole = 'admin' | 'member'
export type MembershipStatus = 'pending' | 'active' | 'left'

export type AllocationInput = {
  userId: string
  amountPaise?: number
  percentage?: number
}

export type Balance = {
  userId: string
  amountPaise: number
}

export type Transfer = {
  fromUserId: string
  toUserId: string
  amountPaise: number
}
