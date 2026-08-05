# 01 — VPS & Project Setup

> **KICKOFF PROMPT — copy everything between the lines and paste into Hermes:**
>
> ---
> You are the EXECUTOR for the Vaani AI project. All planning is done. Your job is to
> execute instructions EXACTLY, verify every step, and report results. Rules:
> 1. Read `/root/vaani-ai/plan/00_MASTER_PLAN.md` first, then
>    `/root/vaani-ai/plan/01_vps_and_project_setup.md` (this file is the task).
> 2. Follow the steps IN ORDER. Never skip, never reorder, never substitute tools or
>    versions. If a step tells you to create a file with given contents, create it
>    EXACTLY as shown — do not truncate, do not "improve".
> 3. After EVERY step, run its **Verify** command and compare the output to **Expected**.
>    If it matches, continue. If not, follow the step's **If it fails** block. Max 2
>    fix attempts per step, then STOP and report: step number, exact command, full
>    error output.
> 4. Never install package versions other than the pinned ones. Never add packages that
>    are not listed. Never put secrets in code or git.
> 5. When the whole file is done, print the **FINAL REPORT**: for each step, one line
>    `STEP n: PASS/FAIL — one-line evidence`, then the acceptance checklist results.
> ---

---

## Goal

By the end of this file you have: a hardened Ubuntu 24.04 VPS with Docker, Node 20, and
Git; the `vaani-ai` repository created; a Next.js 14 + Tailwind + TypeScript skeleton
that renders a placeholder page at `http://localhost:3000`; dev infrastructure
(PostgreSQL 16, Redis 7, MinIO) running in Docker; a complete `.env.example` covering
every variable the full-scope build needs; and the directory skeleton (`tests/`,
`e2e/`, `scripts/`, and the live/integrations/reseller/settings route folders) that
later guides fill in.

**Time estimate:** 1–2 hours.

---

## Prerequisites (human operator)

- A VPS: Ubuntu 24.04 LTS, minimum **4 vCPU / 8 GB RAM / 80 GB disk** (Hetzner CX32 or
  DigitalOcean equivalent). You have the root password or an SSH key.
- You can SSH in from your local machine: `ssh root@<VPS_IP>`.
- No domain needed yet (guide 12 adds it).

**Executor assumption:** you are running as `root` on the VPS over SSH, working
directory `/root`. All commands below run on the VPS unless stated otherwise.

---

## Step 1: Update the OS and install base packages

**Do:**
```bash
apt-get update && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
apt-get install -y curl wget git ufw fail2ban htop unzip ca-certificates gnupg
```

**Verify:**
```bash
git --version && ufw --version && fail2ban-client --version
```
**Expected:** three version strings print (git ≥ 2.43, ufw ≥ 0.36, fail2ban ≥ 1.0).
**If it fails:** run `apt-get install -f` then re-run the install command. If a package
is "not found", run `apt-get update` again and retry.

---

## Step 2: Create a non-root deploy user

Hermes will do most work as root for simplicity in early phases, but the app will run
as a non-root user in production (guide 12). Create it now.

**Do:**
```bash
useradd -m -s /bin/bash deploy
usermod -aG sudo deploy
echo "deploy ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/deploy
mkdir -p /home/deploy/.ssh && cp /root/.ssh/authorized_keys /home/deploy/.ssh/ 2>/dev/null || true
chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys 2>/dev/null || true
```

**Verify:**
```bash
id deploy
```
**Expected:** one line containing `uid=1000(deploy) gid=1000(deploy) groups=...(sudo)`.
**If it fails:** if `useradd` says the user exists, that is fine — continue.

---

## Step 3: Firewall — allow only SSH, HTTP, HTTPS

**Do:**
```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

**Verify:**
```bash
ufw status
```
**Expected:** `Status: active` and exactly three ALLOW rules: `22/tcp`, `80/tcp`,
`443/tcp`.
**If it fails:** do NOT disable the firewall. Re-run the `ufw allow` lines. WARNING:
never close port 22 before confirming your SSH session works.

---

## Step 4: Install Docker Engine + Compose plugin

**Do:**
```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
usermod -aG docker deploy
```

**Verify:**
```bash
docker --version && docker compose version && docker run --rm hello-world | head -n 2
```
**Expected:** Docker ≥ 26.x, Compose ≥ v2.27, and the text `Hello from Docker!`.
**If it fails:** run `systemctl status docker --no-pager` and include the last 20 lines
in your report. Most common cause: keyring step typo — redo Step 4 exactly.

---

## Step 5: Install Node.js 20 LTS (system-wide)

**Do:**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
```

**Verify:**
```bash
node --version && npm --version
```
**Expected:** `v20.x.x` and `10.x.x`. If Node prints v18 or v22, STOP and report —
do not continue on the wrong version.
**If it fails:** `apt-cache policy nodejs | head -5` and report the output.

---

## Step 6: Create the repository and the plan folder

The playbook files (this folder) must live inside the repo so Hermes can read them.

**Do:**
```bash
mkdir -p /root/vaani-ai/plan
cd /root/vaani-ai
git init
git config user.name "vaani-builder"
git config user.email "builder@vaani.local"
```

Then the **human operator** copies all files from the `plan/` folder of this playbook
into `/root/vaani-ai/plan/` on the VPS (e.g. `scp -r plan/ root@<VPS_IP>:/root/vaani-ai/plan/`).
Hermes: if files are missing at read time, STOP and ask the operator to upload them.

**Verify:**
```bash
ls /root/vaani-ai/plan/
```
**Expected:** at minimum `00_MASTER_PLAN.md` and `01_vps_and_project_setup.md` listed.
**If it fails:** files not uploaded yet — operator action required, not a code problem.

---

## Step 7: Scaffold Next.js 14 (pinned) with TypeScript + Tailwind

Run the scaffolder NON-interactively with exact flags. Do not let it pick versions.

**Do:**
```bash
cd /root/vaani-ai
npx --yes create-next-app@14.2.15 . \
  --typescript --tailwind --eslint --app --src-dir \
  --import-alias "@/*" --use-npm --no-turbopack
```
If it prompts `Ok to proceed?` answer yes (the `--yes` flag handles it). If it asks any
other question, STOP — the scaffold must be non-interactive.

Then pin exact dependency versions (this overrides the caret ranges):

**Do:**
```bash
cd /root/vaani-ai
npm install --save-exact next@14.2.15 react@18.3.1 react-dom@18.3.1
npm install --save-exact -D typescript@5.6.3 tailwindcss@3.4.14 @types/react@18.3.11 @types/react-dom@18.3.1 @types/node@20.16.11 eslint@8.57.1 eslint-config-next@14.2.15
```

**Verify:**
```bash
node -e "const p=require('./package.json');console.log(p.dependencies.next, p.dependencies.react, p.devDependencies.typescript, p.devDependencies.tailwindcss)"
```
**Expected:** `14.2.15 18.3.1 5.6.3 3.4.14` (no `^` or `~` characters).
**If it fails:** edit `package.json` so these four entries match exactly, run
`rm -rf node_modules package-lock.json && npm install`, then verify again.

---

## Step 8: Install all pinned project dependencies

These are used by later guides. Install them NOW so every later `npm install` is a no-op.

**Do:**
```bash
cd /root/vaani-ai
npm install --save-exact \
  @prisma/client@5.22.0 bcryptjs@2.4.3 jose@5.9.6 zod@3.23.8 \
  bullmq@5.25.1 ioredis@5.4.1 minio@8.0.2 papaparse@5.4.1 \
  razorpay@2.9.4 recharts@2.13.3 \
  clsx@2.1.1 tailwind-merge@2.5.4 class-variance-authority@0.7.0 \
  lucide-react@0.454.0 @radix-ui/react-slot@1.1.0 @radix-ui/react-dialog@1.1.2 \
  @radix-ui/react-dropdown-menu@2.1.2 @radix-ui/react-label@2.1.0 \
  @radix-ui/react-select@2.1.2 @radix-ui/react-tabs@1.1.1
npm install --save-exact -D \
  prisma@5.22.0 tsx@4.19.1 vitest@2.1.3 @types/bcryptjs@2.4.6 @types/papaparse@5.3.15
```

**Do NOT install the feature-scoped dependencies here.** They are installed by their
owning guides at the pinned versions declared in `00_MASTER_PLAN.md` §3:
- `otplib@12.0.1` + `qrcode@1.5.4` + `@types/qrcode@1.5.5` — TOTP 2FA, installed in **guide 03**
- `googleapis@144.0.0` — Google SSO + Google Calendar, installed in **guide 03**
- `mime-types@2.1.35` + `@types/mime-types@2.1.4` — KB upload content-type detection, installed in **guide 05**
- `nodemailer@6.9.16` + `@types/nodemailer@6.4.17` — email (message summaries, digests, alerts), installed in **guide 06**
- `node-cron@3.0.3` + `@types/node-cron@3.0.11` — worker schedulers (campaign retries; retention/digest sweeps in guide 08), installed in **guide 07**
- `stripe@17.3.1` — installed in **guide 09**
- `@playwright/test@1.48.2` — Playwright E2E — **installed in guide 11** (not here)

**Verify:**
```bash
npm ls prisma bullmq jose zod razorpay minio 2>&1 | tail -n 8
```
**Expected:** each listed with the exact pinned version, no `UNMET DEPENDENCY` lines.
**If it fails:** read the npm error; if it is a peer-dependency complaint, re-run the
same command with `--legacy-peer-deps` appended and note the deviation in your report.

---

## Step 9: Dev infrastructure — docker-compose.yml

Create `docker-compose.yml` in the repo root with EXACTLY this content:

```yaml
services:
  db:
    image: postgres:16
    container_name: vaani-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: vaani
      POSTGRES_PASSWORD: vaani_dev_password
      POSTGRES_DB: vaani
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U vaani -d vaani"]
      interval: 5s
      timeout: 3s
      retries: 20

  redis:
    image: redis:7
    container_name: vaani-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 20

  minio:
    image: minio/minio:latest
    container_name: vaani-minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: vaani
      MINIO_ROOT_PASSWORD: vaani_dev_minio_password
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - miniodata:/data

volumes:
  pgdata:
  miniodata:
```

**Do:**
```bash
cd /root/vaani-ai
docker compose up -d
sleep 10
```

**Verify:**
```bash
docker compose ps --format "table {{.Name}}\t{{.Status}}"
```
**Expected:** three containers `vaani-db`, `vaani-redis`, `vaani-minio`, db and redis
showing `(healthy)`, minio `running`.
**If it fails:** `docker compose logs db --tail 30` (or the failing service) and report.
Port already in use → something else is running on 5432/6379/9000; report it, do not
kill unknown processes.

---

## Step 10: Environment files

Create `.env.example` in the repo root with EXACTLY this content. This documents every
environment variable the skeleton needs plus the canonical names other guides consume.
Later guides may add variables, but every NEW env var MUST: (a) be defined in its
owning guide's env step, (b) be appended to BOTH `.env` and `.env.example` using
grep-guarded appends (`grep -q '^KEY=' .env || echo 'KEY=value' >> .env`), and (c)
never redefine a variable another guide owns.

```bash
# ============================================================================
# Vaani AI — environment template. Copy to .env and fill in real values.
# .env is NEVER committed (it is listed in .gitignore).
# ============================================================================

# --- App ---
NODE_ENV=development                       # node environment: development | production
APP_URL=http://localhost:3000              # server-side base URL of the app
NEXT_PUBLIC_APP_URL=http://localhost:3000  # public URL embedded in emails/links; visible to the browser
DOMAIN=localhost                           # bare domain; Caddy uses it for HTTPS in prod (guide 12)

# --- Database / Queue / Storage ---
DATABASE_URL=postgresql://vaani:vaani_dev_password@localhost:5432/vaani  # Prisma connection string
REDIS_URL=redis://localhost:6379           # BullMQ broker + cache
S3_ENDPOINT=http://localhost:9000          # MinIO S3 endpoint (call recordings)
S3_ACCESS_KEY=vaani                        # MinIO access key (dev root user)
S3_SECRET_KEY=vaani_dev_minio_password     # MinIO secret key (dev root password)
S3_BUCKET_RECORDINGS=vaani-recordings      # bucket name for call recordings

# --- Auth (guide 03) ---
# 32+ byte random string. Generate with: openssl rand -hex 32
SESSION_SECRET=CHANGE_ME_openssl_rand_hex_32   # signs session JWT cookies
# Google SSO + Google Calendar sync (guides 03/05). Google Cloud Console → OAuth 2.0 client (web).
GOOGLE_CLIENT_ID=CHANGE_ME                 # Google OAuth client id
GOOGLE_CLIENT_SECRET=CHANGE_ME             # Google OAuth client secret
# SAML SSO (OPTIONAL — enterprise workspaces only). Managed-provider bridge
# (WorkOS / Auth0) — see guide 03's OPERATOR GATE. Leave blank if unused.
SAML_PROVIDER=                             # managed SSO provider name (e.g. workos, auth0)
SAML_CLIENT_ID=                            # provider client id
SAML_CLIENT_SECRET=                        # provider client secret

# --- Dograh (self-hosted voice orchestration, guide 04) ---
DOGRAH_BASE_URL=http://localhost:8000      # Dograh API base URL
DOGRAH_API_KEY=CHANGE_ME                   # Dograh API key
DOGRAH_WEBHOOK_SECRET=CHANGE_ME_openssl_rand_hex_32  # HMAC secret for verifying Dograh webhook signatures

# --- Voice stack (also configured inside Dograh's own .env in guide 04) ---
SARVAM_API_KEY=CHANGE_ME                   # Sarvam.ai STT/TTS subscription key
OPENROUTER_API_KEY=CHANGE_ME               # OpenRouter LLM routing key

# --- Billing (guide 09) ---
RAZORPAY_KEY_ID=CHANGE_ME                  # Razorpay key id (test mode first)
RAZORPAY_KEY_SECRET=CHANGE_ME              # Razorpay key secret
RAZORPAY_WEBHOOK_SECRET=CHANGE_ME          # verifies Razorpay webhook signatures
STRIPE_SECRET_KEY=CHANGE_ME                # Stripe secret key (test mode first, sk_test_...)
STRIPE_WEBHOOK_SECRET=CHANGE_ME            # verifies Stripe webhook signatures (whsec_...)

# --- Email / SMTP (nodemailer — digests, alerts, summaries; guides 08/12) ---
SMTP_HOST=localhost                        # SMTP server host (e.g. smtp.resend.com)
SMTP_PORT=587                              # SMTP port (587 STARTTLS / 465 SSL)
SMTP_USER=CHANGE_ME                        # SMTP username
SMTP_PASS=CHANGE_ME                        # SMTP password or provider API key
SMTP_FROM=Vaani AI <no-reply@example.com>  # From: header for outbound mail

# --- Worker schedulers (read by guide 08's scheduler code; node-cron installed in guide 07) ---
RETENTION_CRON=30 3 * * *                  # node-cron expression, nightly 03:30 — auto-delete recordings/transcripts per RetentionPolicy (guide 08 reads this)
DIGEST_CRON=5 * * * *                      # node-cron expression, hourly at :05 — sends due scheduled email digests (guide 08 reads this)
WEBHOOK_RETRY_INTERVAL_MS=15000            # milliseconds between failed outbound-webhook retry sweeps — a setInterval, NOT a cron (guide 08 reads this)

# --- Public REST API (guide 08) ---
PUBLIC_API_RATE_LIMIT=120                  # requests per minute allowed per API key

# --- Alerting / observability (guide 12) ---
ALERT_SLACK_WEBHOOK_URL=                   # Slack (or PagerDuty) incoming webhook for ops alerts; blank = disabled

# --- CRM integrations (OPTIONAL, guides 05/08). Leave blank until a customer needs them. ---
HUBSPOT_CLIENT_ID=                         # HubSpot OAuth app client id (blank = integration disabled)
HUBSPOT_CLIENT_SECRET=                     # HubSpot OAuth app client secret
```

Then create the real `.env` (NEVER committed):

**Do:**
```bash
cd /root/vaani-ai
cp .env.example .env
sed -i "s/CHANGE_ME_openssl_rand_hex_32/$(openssl rand -hex 32)/" .env
```

Create `.gitignore` additions — append these lines to the existing `.gitignore`
(create the file if missing):

```
.env
*.local
plan/*.draft.md
```

**Verify:**
```bash
grep -c CHANGE_ME .env; grep "^.env$" .gitignore
```
**Expected:** first command prints `12` (the keys the human must fill later —
Google ×2, Dograh API key, Sarvam, OpenRouter, Razorpay ×3, Stripe ×2, SMTP user/pass),
second prints `.env`.
**If it fails:** re-run the `sed` line; confirm `openssl` exists (`which openssl`).
If the count is not `12`, diff `.env` against `.env.example` — only the two
`CHANGE_ME_openssl_rand_hex_32` values may differ.

---

## Step 11: Base app shell — Tailwind theme, fonts, root layout, directory skeleton

Later guides build on these exact files and directories. Create them precisely.

**File `src/lib/utils.ts`:**
```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

**File `src/app/globals.css`** — replace the whole file with:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --background: 222 47% 5%;
  --foreground: 210 40% 96%;
  --card: 222 47% 8%;
  --card-foreground: 210 40% 96%;
  --primary: 174 72% 46%;
  --primary-foreground: 222 47% 6%;
  --muted: 217 33% 15%;
  --muted-foreground: 215 20% 60%;
  --border: 217 33% 16%;
  --ring: 174 72% 46%;
}

* {
  border-color: hsl(var(--border));
}

body {
  background-color: hsl(var(--background));
  color: hsl(var(--foreground));
  font-feature-settings: "ss01", "cv11";
}
```

**File `tailwind.config.ts`** — replace the whole file with:
```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        border: "hsl(var(--border))",
        ring: "hsl(var(--ring))",
      },
      borderRadius: { lg: "0.75rem", md: "0.5rem", sm: "0.375rem" },
    },
  },
  plugins: [],
};
export default config;
```

**File `src/app/layout.tsx`** — replace the whole file with:
```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vaani AI — AI Voice Agents for Indian Businesses",
  description:
    "The AI receptionist that speaks your customer's language. Answers every call, 24/7, in 11+ Indian languages.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
```

**File `src/app/page.tsx`** — replace the whole file with (placeholder; guide 10 builds
the real landing page):
```tsx
export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-5xl font-bold tracking-tight">
          Vaani <span className="text-primary">AI</span>
        </h1>
        <p className="mt-4 text-muted-foreground">
          Setup complete. The million-dollar build starts here.
        </p>
      </div>
    </main>
  );
}
```

**Directory skeleton** — create the folders later guides fill in (matches
`00_MASTER_PLAN.md` §4). The parentheses are literal — quote the paths:

**Do:**
```bash
cd /root/vaani-ai
mkdir -p "src/app/(app)/settings" "src/app/(app)/live" "src/app/(app)/integrations" "src/app/(app)/reseller" \
  src/app/api/v1 src/lib/integrations src/server/actions src/worker \
  tests e2e scripts
touch tests/.gitkeep e2e/.gitkeep scripts/.gitkeep
```

**Verify:**
```bash
cd /root/vaani-ai
npx tsc --noEmit
ls -d "src/app/(app)/settings" "src/app/(app)/live" "src/app/(app)/integrations" "src/app/(app)/reseller" src/app/api/v1 src/lib/integrations tests e2e scripts
```
**Expected:** `tsc` prints nothing and exits 0 (`echo $?` prints `0`); then `ls` lists
all 9 paths with no "No such file or directory" errors.
**If it fails:** the type error message names the file — re-create that file exactly as
shown above and re-verify. For a missing directory, re-run the `mkdir -p` line exactly
(with the quotes around parenthesized paths).

---

## Step 12: Boot the dev server and smoke-test

**Do:**
```bash
cd /root/vaani-ai
(npm run dev > /tmp/next-dev.log 2>&1 &)
sleep 15
curl -s http://localhost:3000 | grep -o "Vaani" | head -n 1
```

**Expected:** prints `Vaani`.
Also run `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000` → expected `200`.
**If it fails:** `tail -n 40 /tmp/next-dev.log` — the error is there. Fix per the log,
re-run. Do not continue until curl prints 200. Then stop the dev server:
`pkill -f "next dev" || true`.

---

## Step 13: Add standard npm scripts

In `package.json`, make the `"scripts"` block exactly this (keep everything else in the
file unchanged):

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:e2e": "playwright test",
  "prisma:generate": "prisma generate",
  "prisma:migrate": "prisma migrate dev",
  "prisma:seed": "tsx prisma/seed.ts",
  "worker": "tsx src/worker/index.ts"
}
```

(The `test:e2e` script is wired up in guide 11 when Playwright is installed; until then
running it will fail with "playwright: command not found" — that is expected, do not
install Playwright now.)

**Verify:**
```bash
npm run typecheck && node -e "console.log(Object.keys(require('./package.json').scripts).length)"
```
**Expected:** typecheck passes silently, then prints `10`.
**If it fails:** JSON syntax error in package.json — run `node -e "require('./package.json')"`
to see the parse error line, fix the JSON.

---

## Step 14: Production build sanity check + git checkpoint

**Do:**
```bash
cd /root/vaani-ai
npm run build
```
**Expected:** build ends with `✓ Compiled successfully` (or `Compiled successfully`)
and a route table containing `○ /` and `ƒ`/`○` entries. No red errors.

Then checkpoint:
```bash
git add -A
git commit -m "phase 01: VPS + Next.js 14 skeleton, dev infra, base theme, full-scope env template"
git log --oneline | head -n 1
```
**Expected:** one commit line starting with `phase 01:`.

**If build fails:** paste the first error block into your report. Common causes:
a file from Step 11 not created exactly — re-create and rebuild.

---

## Acceptance Checklist (all must be YES before moving to guide 02)

- [ ] `ufw status` → active, only 22/80/443 allowed
- [ ] `docker compose ps` → db + redis healthy, minio running
- [ ] `node --version` → v20.x
- [ ] `package.json` dependencies match pinned versions (no `^`)
- [ ] `.env` exists, `.gitignore` contains `.env`, `git status` does NOT list `.env`
- [ ] `.env.example` contains every section: App, Database/Queue/Storage, Auth
      (SESSION_SECRET, GOOGLE_CLIENT_ID/SECRET, SAML_PROVIDER/CLIENT_ID/CLIENT_SECRET),
      Dograh, Voice stack, Billing (RAZORPAY_* and STRIPE_*), SMTP_*, schedulers
      (RETENTION_CRON, DIGEST_CRON, WEBHOOK_RETRY_INTERVAL_MS), PUBLIC_API_RATE_LIMIT,
      ALERT_SLACK_WEBHOOK_URL, HUBSPOT_CLIENT_ID/SECRET — and `grep -c CHANGE_ME .env`
      prints `12`
- [ ] Directory skeleton exists: `src/app/(app)/settings`, `src/app/(app)/live`,
      `src/app/(app)/integrations`, `src/app/(app)/reseller`, `src/app/api/v1`,
      `src/lib/integrations`, `tests/`, `e2e/`, `scripts/`
- [ ] `npm run typecheck` → exit 0
- [ ] `npm run build` → success
- [ ] `curl -s localhost:3000` (with dev server running) → contains `Vaani`
- [ ] `git log --oneline` → `phase 01: ...` commit exists

## FINAL REPORT format

```
STEP 1..14: PASS/FAIL — <one line of evidence each>
ACCEPTANCE: n/11 checked
NOTES: <any deviations, e.g. --legacy-peer-deps used>
```
