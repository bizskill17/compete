# Compete administration

Open `/admin`, or use **Admin login** in the public footer. Signed-in administrators can also use the header's **Admin dashboard** link.

## First administrator

There is no default password or public administrator signup. Set `ADMIN_EMAIL` and a temporary `ADMIN_SETUP_PASSWORD` (4–20 characters) in the server command environment, along with the same MySQL settings used by the application. Run `npm run create-admin`, then remove the temporary setup password. An existing account requires the explicit `npm run recover-admin` command instead. hPanel environment variables may not be inherited by SSH commands. Do not put credentials in the repository or expose these commands as HTTP endpoints.

## Included

- Dashboard metrics from stored accounts, competitions, entries and verified payment registrations.
- Categories: create, edit and activate/deactivate. Category names cannot be changed while used by a competition. Existing legacy categories are listed until added to the category master.
- Competitions: create drafts and edit title, category, rules, theme, fee, prizes, deadline and open/closed status. Existing server restrictions lock commercial details after orders exist. Deadlines are 11:59 PM IST. Submission support remains images only.
- Participants: create participant accounts and edit names/status. Email is fixed when editing. Suspension revokes sessions and blocks login. Admin creation remains a server-only operation. No invitation email is sent; initial credentials must be shared securely.
- Entries and judging: privately inspect artwork, accept/reject with remarks, run configured AI scoring, and open participation certificates. Rejected entries are excluded from public leaderboards and cannot be AI-scored until accepted again. Review does not erase existing scorecards.
- Payments: read-only order records with verified paid/pending status. No refund or prize payout action is performed.
- Settings: configuration-presence indicators only; secret values are never sent to the browser. These are not provider connectivity checks.

This release does not add result publication, judge assignment, certificate template editing, email delivery, password recovery, non-image submissions or new participant-facing profile workflows.

## Validation

`npm run build` checks server and both browser scripts. `npm test` exercises existing payment/authentication flows plus admin authorization, category management, participant creation/suspension, review/leaderboard behavior, secret redaction and browser form/navigation behavior. Target-host MySQL and deployment checks must still run on Hostinger.
