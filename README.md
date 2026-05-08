# Expense Splitter

Production-ready starter for a React + Express + Prisma expense splitter that can run locally with PostgreSQL and deploy to Render with Neon PostgreSQL.

## Features

- Email/password auth with JWT
- Group creation and member invites by registered email
- Equal expense splitting with stored per-member splits
- Balance summaries and suggested settlement payments
- Settlement recording
- Prisma migrations ready for Neon/Render
- Vite + Tailwind client

## Local Setup

### 1. Install dependencies

```bash
cd client
npm install

cd ../server
npm install
```

### 2. Configure environment

Copy the examples:

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

For local Docker PostgreSQL, keep:

```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/expense_splitter?schema=public"
JWT_SECRET="replace-with-a-long-random-secret"
PORT=5000
CLIENT_ORIGIN="http://localhost:5173"
```

### 3. Start PostgreSQL

```bash
docker compose up -d postgres
```

### 4. Run migrations

```bash
cd server
npm run db:deploy
```

### 5. Start the apps

Terminal 1:

```bash
cd server
npm run dev
```

Terminal 2:

```bash
cd client
npm run dev
```

Open `http://localhost:5173`.

## Deploy to Render + Neon

### 1. Create Neon database

Create a Neon project, then copy the pooled connection string. It should look like:

```env
postgresql://user:password@ep-name-pooler.region.aws.neon.tech/dbname?sslmode=require
```

Use that as `DATABASE_URL` in Render.

### 2. Deploy backend on Render

Create a new Render **Web Service** from the repo:

- Root Directory: `server`
- Build Command: `npm install && npm run build`
- Start Command: `npm run db:deploy && npm start`
- Health Check Path: `/api/health`

Environment variables:

```env
DATABASE_URL=<your Neon pooled URL>
JWT_SECRET=<long random value>
CLIENT_ORIGIN=<your Render static site URL>
SMTP_HOST=<optional SMTP host>
SMTP_PORT=587
SMTP_USER=<optional SMTP username>
SMTP_PASS=<optional SMTP password>
MAIL_FROM=<optional from email>
```

Email notifications are optional. If the SMTP values are blank, adding members still works and the server logs that email is skipped.

Deploy it and copy the API URL, for example:

```text
https://expense-splitter-api.onrender.com/api
```

### 3. Deploy frontend on Render

Create a Render **Static Site**:

- Root Directory: `client`
- Build Command: `npm install && npm run build`
- Publish Directory: `dist`

Environment variable:

```env
VITE_API_URL=https://expense-splitter-api.onrender.com/api
```

After the static site URL is created, update the backend `CLIENT_ORIGIN` to that exact frontend URL and redeploy the backend.

## API Health

```bash
curl https://your-api.onrender.com/api/health
```

Expected response:

```json
{ "status": "ok", "timestamp": "..." }
```
