# FinLit API

Set `MONGODB_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `CLIENT_URL`, `PORT`, and `NODE_ENV` from `.env.example`. Start the API with `npm run backend:dev`.

All responses use `{ success: true, data }` or `{ success: false, error: { code, message } }`. Sessions use an HttpOnly `session` cookie; bearer tokens are also accepted for API clients.

## Auth
- `POST /api/auth/session` with `{ displayName }`
- `GET /api/auth/me`
- `POST /api/auth/logout`

## Rooms and membership
- `POST /api/rooms` with `{ name, recoveryPassword? }`
- `GET /api/rooms`
- `POST /api/rooms/join` with `{ roomId }`
- `GET /api/rooms/:roomId`
- `GET /api/rooms/:roomId/requests` (admin)
- `PATCH /api/rooms/:roomId/requests/:membershipId` with `{ action: "approve" | "reject" }`
- `POST /api/rooms/:roomId/leave`

## Expenses and payments
- `POST /api/rooms/:roomId/expenses`
- `GET /api/rooms/:roomId/expenses?page=1&limit=20`
- `GET /api/expenses/:expenseId`
- `GET /api/expenses/:expenseId/history`
- `PATCH /api/expenses/:expenseId`
- `POST /api/expenses/:expenseId/void`
- `GET /api/rooms/:roomId/payments`
- `POST /api/rooms/:roomId/payments`

Amounts are integer paise. Equal splits are calculated on the server and distribute remainder paise deterministically.

## Finance and activity
- `GET /api/rooms/:roomId/balances`
- `GET /api/rooms/:roomId/suggestions`
- `GET /api/rooms/:roomId/activity`
- `GET /api/rooms/:roomId/summary?month=2026-10`
- `GET /api/rooms/:roomId/summary.pdf`
