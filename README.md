# Compete

Creative competition platform with competition landing pages, prize pools, paid entries, artwork submission, AI scoring, leaderboards, and participation certificates.

## Implementation

Dependency-free JavaScript ES module running on Cloudflare Workers, with R2 object storage (`BUCKET`). The responsive interface is embedded in `worker/index.js`.

## Build

Requires Node.js and Bash.

```sh
npm run build
npm run validate
```

The deployment artifact is written to `dist/`. The `.openai/hosting.json` manifest identifies the existing ChatGPT Site. This repository is a source copy; GitHub pushes do not automatically deploy the Site.

## Required runtime configuration

Configure these on the server, never in browser code or Git:

- `ADMIN_EMAIL`: email allowed to manage competitions.
- `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`: Razorpay credentials.
- `OPENAI_API_KEY`: AI judging credentials.
- `OPENAI_MODEL`: optional judging model override.

Hosted identity uses the trusted `oai-authenticated-user-id` and `oai-authenticated-user-email` headers supplied by ChatGPT Sites. Do not deploy directly on another host without replacing that authentication boundary.

## Current status

The private Site is published at https://compete-creative-studio.capankajjain.chatgpt.site . Payment and AI credentials and administrator email are not configured. The Diwali competition is a labeled sample until an administrator creates a real competition. Prize disbursement is organizer-managed. Certificates can be printed or saved as PDF from the browser.

## Before accepting real payments

Complete payment testing and operational review, including payment recovery/webhooks, refund handling, submission concurrency, final winner review, and applicable competition terms. Automated checks covered basic authorization, competition creation, absent credentials and JavaScript syntax. Visual browser QA remains pending.
