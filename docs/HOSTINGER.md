# Hostinger deployment guide (deployment is on hold)

The code is prepared for a Node.js Web App. Do not upload only `public/index.html`: payments, accounts, storage and judging require `server.js`.

## 1. Prepare the domain and MySQL

1. In hPanel, create a Node.js Web App using the eventual domain or a subdomain such as `compete.example.com`.
2. Create a MySQL database and user in Databases → Management.
3. Use the full prefixed database/user names shown by Hostinger.
4. Set DB_HOST to `127.0.0.1` for a Hostinger-hosted database. Use the host actually supplied by your provider if using an external database.
5. Back up the database regularly. The application automatically creates only its own `compete_objects` and `compete_object_parts` tables on startup; it does not replace other tables.

Hostinger's official guidance: https://www.hostinger.com/support/connecting-a-hostinger-mysql-database-to-a-node-js-application/

## 2. Connect source when deployment is authorized

Select GitHub repository `bizskill17/compete`, branch `main`, root directory `/`, Node.js 22 or later. Build command: `npm run build`. Start command: `npm start`. If the panel asks for the application entry file, choose `server.js`. This is a server application, not a static Vite/React deployment. Do not select `dist` as its output.

Official Node.js setup: https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/

## 3. Runtime settings

| Variable | Value / purpose |
|---|---|
| NODE_ENV | `production` |
| APP_URL | Exact HTTPS origin, e.g. `https://compete.example.com` (no subdirectory) |
| DB_HOST | `127.0.0.1` for Hostinger local MySQL |
| DB_PORT | `3306` unless the provider says otherwise |
| DB_USER | Full MySQL username |
| DB_PASSWORD | MySQL password; secret |
| DB_NAME | Full database name |
| ADMIN_EMAIL | Reserved organizer email |
| RAZORPAY_KEY_ID | Start with test-mode key |
| RAZORPAY_KEY_SECRET | Matching secret |
| RAZORPAY_WEBHOOK_SECRET | Independent webhook signing secret |
| OPENAI_API_KEY | Secret for the judging service |
| OPENAI_MODEL | Optional; default `gpt-4o`; account must support image inputs |

Let Hostinger set PORT. With production enabled, participant sessions use secure cookies. All browser write requests require an Origin matching APP_URL. The reverse proxy must forward the browser's Origin and Cookie headers unchanged; arbitrary forwarded user identity headers are ignored.

## 4. Create the organizer

With the same database settings loaded in the server terminal/SSH environment, temporarily set ADMIN_SETUP_PASSWORD as a secret and run `npm run create-admin`. Remove the temporary value afterward. Shells may not inherit hPanel app variables; ensure the command uses the same settings. Passwords must contain 4–20 characters. No default administrator password is shipped.

## 5. Configure Razorpay test mode

1. Add test credentials in hPanel.
2. In Razorpay, configure webhook URL `https://YOUR-DOMAIN/api/payments/webhook`.
3. Subscribe to `payment.captured` and `order.paid` and use the matching RAZORPAY_WEBHOOK_SECRET.
4. Ensure payments are captured by your Razorpay configuration; authorization alone does not unlock submissions.
5. Test success, failure, cancellation, callback loss and repeated webhook deliveries.

A participant who has paid can retry the entry form without another charge: the app checks the saved order's captured payments. Webhooks are verified against the original raw request bytes. Order amount and currency are server-checked. Changing a competition's theme, rules, fee or prizes is blocked after its first order; deadline and status can still be edited.

## 6. Verify the actual deployment

- Check `/health`, the application logs and database tables.
- Create a participant, log out/in, and confirm an account cannot impersonate an organizer.
- Create a draft and verify it is hidden from public visitors, then open a test competition.
- Complete a test payment, upload a photograph and save the participation certificate as PDF.
- Run AI scoring and confirm leaderboard ordering and feedback.
- Restart/redeploy, then verify accounts, payments, uploads and certificates survive.
- Check a mobile browser, keyboard navigation and certificate printing.
- Back up and restore a test database before taking real entries.

## Limits in this revision

Accounts use email/password with organizer-assisted recovery; email delivery/verification is not configured. Uploads are limited to 5 MB and stored in MySQL, so monitor database quota and backup size. No existing R2 data migration is performed. Prize payout and refund processing are manual. No public deployment, real payment or real AI request has been performed as part of this GitHub change.
