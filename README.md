# PulseWatch

**Application health and uptime monitoring platform.**

Monitor websites and APIs for availability and performance. Track response times, detect outages, manage incidents, and get notified when things go wrong.

---

## Quick Start (Docker)

### Prerequisites
- Docker ≥ 24
- Docker Compose v2

### 1. Clone and configure

```bash
git clone <repo-url>
cd pulseWatch
cp .env.example .env
```

Edit `.env` and set a secure `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 2. Start services

```bash
docker compose up
```

Services start in dependency order:
1. PostgreSQL and Redis (with health checks)
2. Backend (runs migrations, then starts)
3. Frontend (nginx serving the React SPA)

| Service  | URL                      |
|----------|--------------------------|
| Frontend | http://localhost:80       |
| Backend  | http://localhost:3000     |
| Health   | http://localhost:3000/api/health |

### 3. Tear down

```bash
docker compose down        # Stop services
docker compose down -v     # Stop and delete volumes (loses all data)
```

---

## Local Development (without Docker)

### Prerequisites
- Node.js ≥ 20
- PostgreSQL 16
- Redis 7

### Backend

```bash
cd backend
cp .env.example .env
# Edit .env with your local DATABASE_URL and REDIS_URL

npm install
npm run db:migrate:dev   # Apply Prisma migrations
npm run dev              # Start with nodemon
```

### Frontend

```bash
cd frontend
npm install
npm run dev              # Vite dev server on :5173 with API proxy to :3000
```

---

## Running Tests

```bash
cd backend
npm test                 # Run all tests
npm run test:coverage    # Run with coverage report
```

Tests use mocks — no real database or Redis required.

---

## Project Structure

```
pulseWatch/
├── backend/                 # Node.js / Express API
│   ├── prisma/
│   │   └── schema.prisma    # Database schema
│   ├── src/
│   │   ├── config/          # Env validation (Zod)
│   │   ├── lib/             # Singletons (logger, db, redis)
│   │   ├── middleware/      # requestId, errorHandler, rateLimiter
│   │   └── routes/          # health, (more in later stages)
│   └── tests/
├── frontend/                # React 19 / Vite SPA
│   ├── src/
│   │   ├── components/      # Sidebar, shared UI
│   │   ├── lib/             # axios API client
│   │   └── pages/           # Dashboard, (more in later stages)
│   └── nginx.conf           # Production nginx config
├── docker-compose.yml
└── .env.example
```

---

## Tech Stack

| Layer      | Technology |
|------------|------------|
| Backend    | Node.js, Express, Prisma, PostgreSQL |
| Queue      | BullMQ, Redis |
| Validation | Zod |
| Logging    | Pino |
| Frontend   | React 19, Vite, React Router v7 |
| Charts     | Recharts |
| Icons      | Lucide React |
| Testing    | Jest, Supertest |

---

## Build Stages

- **Stage 1** ✅ — Project foundation, health endpoint, design system, Docker setup
- **Stage 2** — Authentication (register, login, JWT)
- **Stage 3** — Monitor CRUD API + frontend management
- **Stage 4** — Monitoring worker (BullMQ), health checks, failure tracking
- **Stage 5** — Incidents, alerts, notifications
- **Stage 6** — Statistics, analytics, charts
- **Stage 7** — Full test suite
