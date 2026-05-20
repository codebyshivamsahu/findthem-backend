# Find Them India — Backend API 🇮🇳

Express.js + SQLite backend for the Find Them India missing persons platform.

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Seed database with sample data
npm run seed

# 3. Start development server
npm run dev
```

Server runs on: **http://localhost:5000**

---

## 🗄️ Database

Uses **SQLite** via `sql.js` — no external database needed!  
Database file saved at: `find_them_india.db`  
Auto-saves every 5 seconds.

---

## 🔑 Demo Login

| Email | Password |
|-------|----------|
| `demo@findthemindia.gov.in` | `demo1234` |

---

## 📋 API Endpoints

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login (returns JWT token) |
| GET  | `/api/auth/me` | Get current user (auth required) |

### Missing Persons (Cases)
| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/cases` | List cases (filters: query, status, gender, state, district, ageMin, ageMax) |
| GET    | `/api/cases/:id` | Get single case |
| POST   | `/api/cases` | Report new missing person (auth required) |
| PUT    | `/api/cases/:id` | Update case (auth required) |
| PATCH  | `/api/cases/:id/status` | Update case status (auth required) |
| DELETE | `/api/cases/:id` | Delete case (auth required) |
| GET    | `/api/cases/:id/updates` | Get case timeline updates |
| POST   | `/api/cases/:id/updates` | Add update to case (auth required) |

### Sightings
| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/sightings` | List sightings (filter: caseId, status) |
| POST   | `/api/sightings` | Report new sighting (auth required) |
| PATCH  | `/api/sightings/:id/status` | Update sighting status (auth required) |

### Statistics & Alerts
| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/statistics` | Get platform statistics |
| GET    | `/api/statistics/alerts` | Get active alerts |
| POST   | `/api/statistics/alerts` | Create alert (auth required) |
| DELETE | `/api/statistics/alerts/:id` | Dismiss alert (auth required) |

---

## 🏗️ Project Structure

```
src/
├── db/
│   └── database.ts      # SQLite setup (sql.js)
├── middleware/
│   └── auth.ts          # JWT authentication
├── routes/
│   ├── auth.ts          # Login, register, profile
│   ├── cases.ts         # Missing persons CRUD
│   ├── sightings.ts     # Sighting reports
│   └── statistics.ts    # Stats & alerts
├── seed.ts              # Database seeder
└── server.ts            # Express app entry point
```

---

## 🔧 Authentication

Use `Authorization: Bearer <token>` header for protected routes.

```bash
# Login
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@findthemindia.gov.in","password":"demo1234"}'

# Use the token
curl http://localhost:5000/api/cases \
  -H "Authorization: Bearer <your_token>"
```

---

## 🌐 Connect Frontend

In `find-them-india/.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:5000
```

Then run both servers:
```bash
# Terminal 1 — Backend
cd find-them-backend && npm run dev

# Terminal 2 — Frontend  
cd find-them-india && npm run dev
```
