# Flatmate Finance

Flatmate Finance is a Vite React frontend with an Express, TypeScript, MongoDB/Mongoose backend.

## Local setup

1. Copy `backend/.env.example` to `backend/.env` and set a MongoDB Atlas connection string plus a JWT secret of at least 32 characters.
2. Install dependencies with `npm install`.
3. Start the API with `npm run backend:dev`.
4. Start the frontend with `npm run dev`.
5. Set `VITE_API_URL=http://localhost:4000` in a root `.env` to enable API-backed room data and mutations. Without it, the approved frontend preview remains available with local mock state.

To load development data into Atlas:

```bash
npm run backend:seed
```

The seed creates the Green Park Flat sample room and example expenses. API details are documented in [backend/API.md](backend/API.md).

## Verification

```bash
npm run build:all
npm run backend:test
npm run lint
```
