# Compete

Modern creative competitions with paid participation, original-image submissions, AI scorecards, leaderboards and participation certificates.

## Current work

The default application is now a standalone Node.js server prepared for Hostinger Web App hosting. This revision is **GitHub-only**: it does not deploy or change the existing ChatGPT Site. Existing `worker/`, `.openai/` and legacy Cloudflare build scripts are retained for the earlier publication; they are not used by `npm start`.

### Included

- Competition discovery, prize pools, deadlines, draft/open/closed states and organizer editing.
- Participant registration, email/password login, server-side sessions and logout.
- Organizer roles granted only by a server-side setup/recovery command. Public registration cannot create an organizer.
- Passwords hashed with salted scrypt; session tokens stored as hashes; HTTP-only, SameSite cookies, with Secure enforced in production.
- MySQL persistence for accounts, sessions, competitions, payments, entries, certificates and uploaded images. Images are transactionally stored in 256 KB chunks; no R2 account or persistent application filesystem is needed in production.
- Razorpay order creation, signature and captured-amount verification, signed webhook handling, and recovery/reuse of orders when the browser callback is lost.
- Server-side locking for duplicate submissions, payment operations and AI score requests, including across application processes with MySQL advisory locks.
- A consistent AI rubric, saved scorecards and printable participation certificates.

## Local development

Use Node.js 22 or later. No frontend compilation is needed.

```sh
npm ci
cp .env.example .env
npm run dev
```

Open `http://127.0.0.1:3000` (not `localhost`, unless APP_URL is also changed to localhost). With `DB_NAME` empty, development data goes to the ignored `data/` directory. The file store is single-process development storage only. Production refuses to start without MySQL and an HTTPS APP_URL.

```sh
npm run build
npm test
```

The integration tests run against a real local HTTP server and temporary filesystem storage. Payment and AI responses are mocked; no paid API requests are made. MySQL integration, Hostinger deployment, visual browser QA and real provider testing remain to be verified on the target environment.

## Organizer setup

Set `ADMIN_EMAIL` and a temporary `ADMIN_SETUP_PASSWORD` in your secure local/server environment, along with your database configuration. Run:

```sh
npm run create-admin
```

Remove `ADMIN_SETUP_PASSWORD` after setup. Sign in through the website using that email and password. ADMIN_EMAIL reserves the email during registration; it does not automatically grant any existing account organizer privileges.

If an existing account must be deliberately promoted or an organizer password must be reset, an operator with server access can set those same temporary variables and run:

```sh
npm run recover-admin
```

This explicit command replaces the password, grants the organizer role and invalidates previous sessions for that account. There is no public password-reset/email verification service in this revision; participants needing recovery must contact the operator. Do not expose these setup commands as HTTP endpoints.

## Hostinger deployment later

Do not enable deployment until ready. See [docs/HOSTINGER.md](docs/HOSTINGER.md) for the exact settings, database setup and activation checks.

- Node.js: 22 or later supported by your plan.
- Root directory: repository root.
- Install: `npm ci`.
- Build: `npm run build` (syntax and browser-script validation; no output directory).
- Start: `npm start`.
- Entry point: `server.js`.
- The app listens on `0.0.0.0` and Hostinger's supplied `PORT`.

Credentials belong in Hostinger environment settings, not GitHub files. `.env.example` contains names only. Existing records on the earlier ChatGPT Site are not automatically migrated to MySQL.

## Before a public paid launch

Complete target-host MySQL/restart testing, browser/mobile QA, Razorpay test payments and webhook verification, refund/support procedures, email verification and participant recovery arrangements, final winner review, competition terms and backup/restore drills. Prize disbursement is handled by the organizer, not automatically sent by this app. AI is an assessment of visible artwork, not proof of originality. Live API credentials have not been configured or tested.
