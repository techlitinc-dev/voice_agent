# 01 — Auth & Onboarding Tests

> Test cases for authentication, registration, password reset, 2FA, SSO, and the
> onboarding wizard.

---

## A. Registration & Login

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| AUTH-01 | Register new workspace | 1. Go to `/register`. 2. Fill email `new@test.vaani.ai`, password `Test@1234!`, workspace "Test Co". 3. Click Register. | Workspace created, user logged in, redirected to `/onboarding`. | ☐ |
| AUTH-02 | Register with existing email | 1. Go to `/register`. 2. Enter `owner@test.vaani.ai`. 3. Submit. | Error: "Email already registered" with login link. | ☐ |
| AUTH-03 | Register with weak password | 1. Register with password `123`. | Validation error: password too short. Form does not submit. | ☐ |
| AUTH-04 | Register with invalid email | 1. Register with email `notanemail`. | Validation error: invalid email. | ☐ |
| AUTH-05 | Login with valid credentials | 1. Go to `/login`. 2. Enter `owner@test.vaani.ai` / `Test@1234!`. 3. Click Login. | Redirected to `/dashboard`. Session cookie set. | ☐ |
| AUTH-06 | Login with wrong password | 1. Login with `owner@test.vaani.ai` / `wrongpass`. | Error: "Invalid email or password". | ☐ |
| AUTH-07 | Login with non-existent email | 1. Login with `nobody@test.vaani.ai`. | Error: "Invalid email or password" (same message — no user enumeration). | ☐ |
| AUTH-08 | Logout | 1. While logged in, click user menu → Logout. | Session revoked in DB, cookie cleared, redirected to `/login`. | ☐ |
| AUTH-09 | Session expiry | 1. Login. 2. Manually set session `expiresAt` to past in DB. 3. Navigate to `/dashboard`. | Redirected to `/login` (middleware catches expired session). | ☐ |
| AUTH-10 | Post-login redirect to intended page | 1. Visit `/crm/pipeline` while logged out. 2. Login. | Redirected to `/crm/pipeline` (not generic dashboard). | ☐ |

## B. Password Reset

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| AUTH-11 | Request password reset | 1. Go to `/login`. 2. Click "Forgot password". 3. Enter `owner@test.vaani.ai`. 4. Submit. | Success message: "Check your email". Email sent with reset link. | ☐ |
| AUTH-12 | Reset password with valid token | 1. Click reset link in email. 2. Enter new password. 3. Submit. | Password updated. Can login with new password. | ☐ |
| AUTH-13 | Reset with expired token | 1. Use a reset link older than expiry. | Error: "Token expired". Offer to request new one. | ☐ |
| AUTH-14 | Reset with already-used token | 1. Use the same reset link twice. | Error: "Token already used" on second attempt. | ☐ |

## C. Two-Factor Authentication (TOTP)

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| AUTH-15 | Enable 2FA | 1. Go to Settings → Security. 2. Click "Enable 2FA". 3. Scan QR in authenticator app. 4. Enter code. | 2FA enabled. Backup codes displayed. Status = ENABLED in DB. | ☐ |
| AUTH-16 | Login with 2FA enabled | 1. Login with email/password. 2. Enter TOTP code. | Redirected to dashboard. | ☐ |
| AUTH-17 | Login with wrong TOTP | 1. Login. 2. Enter wrong 6-digit code. | Error: "Invalid code". | ☐ |
| AUTH-18 | Login with backup code | 1. Login. 2. Click "Use backup code". 3. Enter a backup code from setup. | Login succeeds. Backup code marked used in DB. | ☐ |
| AUTH-19 | Disable 2FA | 1. Settings → Security → Disable 2FA. 2. Confirm with password. | 2FA disabled. Future logins skip TOTP step. | ☐ |

## D. SSO (Google)

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| AUTH-20 | Google SSO login | 1. Go to `/login`. 2. Click "Continue with Google". 3. Choose Google account. | Logged in, redirected to dashboard. `SsoIdentity` row created. | ☐ |
| AUTH-21 | Google SSO for existing email | 1. Register with email that matches a Google account. 2. Later, login via Google SSO. | Account linked (same user, not duplicate). | ☐ |

## E. Onboarding Wizard

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| AUTH-22 | Onboarding step 1: industry | 1. As new user, go to `/onboarding`. 2. Select industry "Healthcare". 3. Click Next. | Step 1 marked complete, advances to template step. | ☐ |
| AUTH-23 | Onboarding step 2: template | 1. Select "Clinic Receptionist" template. 2. Click Next. | Agent created from template, advances to knowledge step. | ☐ |
| AUTH-24 | Onboarding step 3: knowledge | 1. Upload a PDF. 2. Wait for indexing. | Document status changes PENDING → INDEXING → INDEXED. | ☐ |
| AUTH-25 | Onboarding completes with test call | 1. Complete all steps. 2. Click "Make test call". | Test call connects, onboarding marked complete, checklist all green. | ☐ |

---

## Prerequisites

- Staging environment accessible.
- Test email inbox accessible (for reset links).
- Authenticator app (Google Authenticator / Authy) for 2FA.
- A Google account for SSO tests.

## Notes

- For AUTH-09 (session expiry), use `psql` to update the session row directly.
- For 2FA backup codes, save them during setup — each is single-use.
- Test cross-browser: run AUTH-05 on Chrome, Firefox, Safari.