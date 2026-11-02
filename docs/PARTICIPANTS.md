# Participant portal

Public routes: `/` (Explore), `/competition?id=...`, `/results`, `/login`, `/signup`, `/forgot-password`, `/reset-password?token=...`.
Signed-in views: `/dashboard`, `/my-competitions`, `/profile`. Admin access remains `/admin`.

## Registration and submission

New participant accounts require name, email, mobile number and a password of 4–20 characters. The browser asks for password confirmation. Existing accounts and sessions continue working. Profiles can update name and mobile; email is read-only and email changes require organizer assistance. Password changes verify the current password and revoke all sessions.

The existing `/api/order` now records free registrations durably; paid registration still requires Razorpay capture verification. Joining is separate from submission. Pending payment orders are recoverable from My competitions. Repeated joins reuse the existing registration and payment order. Existing entries also appear in the portal even if they predate free registration records.

Only original JPG, PNG or WebP image submissions up to 5 MB are supported in this release. The UI states this explicitly for every category. Coding files, quizzes, audio/video and their judging workflows remain future expansion. No schema changes or replacement of existing database data are needed; objects use the existing persistent store.

## Review and results

AI judging is now an administrator action. Provisional scores, feedback and rubric are hidden from participants and public leaderboards until the organizer publishes final results. Participation certificates require an accepted entry. An accepted AI-flagged image with a valid score may be included after the administrator's review.

Admin → Competitions includes Publish results / Unpublish results. Close the competition (or wait for the deadline), review every entry, and score accepted entries. Publishing stores a snapshot of the accepted entries and their final scores/feedback. Equal scores share a rank. Accepted entries with ranks 1–3 receive an achievement certificate link after publication. The snapshot, not a live provisional score list, drives results. Reviews/deletions and reopening are blocked until results are unpublished. Unpublishing hides final scores and achievement certificates again. AI outages leave entries awaiting assessment; nothing marks a provider failure as rejection.

Existing scores are retained as provisional, and existing entries/certificate identifiers remain intact. Previously immediate participant certificate access now requires admin acceptance. Existing competitions need an explicit Publish results action to reveal final scores.

## Password recovery email setup

Set in Hostinger Environment variables:

| Variable | Value |
| --- | --- |
| `APP_URL` | `https://compete.bizskilledu.com` |
| `RESEND_API_KEY` | A private Resend sending API key |
| `EMAIL_FROM` | A sender email on your verified sending domain, e.g. `Compete <noreply@yourdomain.com>` |

Resend requires a verified sending domain and access to send to your participants. Restart/redeploy after setting environment variables. Keys never appear in browser code. Without email configuration, the reset form clearly reports that password reset email is not configured and asks the participant to contact the organizer.

Reset links expire after 30 minutes, are single-use, and store only a token hash. A password change invalidates outstanding reset links and sessions. Responses do not reveal whether an email has an active account. Participant reset cannot reset an administrator account. Account deletion/recreation does not reuse the original account identity. Sending failures log a generic delivery failure without exposing provider bodies or tokens.

Reference: https://resend.com/docs/api-reference/emails/send-email

## Verification

Automated tests exercise a complete free competition journey, paid capture recovery, duplicate submission prevention, owner-only images, publication gating, winner certificates, profile changes, password changes and single-use reset links. Provider calls are mocked; testing does not send email, charge payments or assess production entries.
