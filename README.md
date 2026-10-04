# Flatmate Finance

Flatmate Finance is split into a Vite React frontend in `frontend/` and an Express + TypeScript backend in `backend/`.

## Local setup

1. Copy `backend/.env.example` to `backend/.env` and set a MongoDB Atlas connection string plus a JWT secret of at least 32 characters.
2. Copy `frontend/.env.example` to `frontend/.env` and set `VITE_API_URL=http://localhost:4000`.
3. Install dependencies with `npm install` from the project root.
4. Start the API with `npm run backend:dev`.
5. Start the frontend with `npm run dev:frontend` or `npm run dev`.

To verify the configured MongoDB connection without changing data:

```bash
npm run backend:db:check
```

To load development data into Atlas:

```bash
npm run backend:seed
```

The seed creates the Green Park Flat sample room and example expenses. API details are documented in [backend/API.md](backend/API.md).

## Verification

```bash
npm run build
npm run backend:test
npm run lint
```
