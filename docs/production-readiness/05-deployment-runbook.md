# 05 — Deployment Runbook

> **Goal:** From "fresh VPS" to "production serving traffic" — step by step, no
> guesswork.

---

## 1. Prerequisites

### 1.1 Server requirements (Small tier)

| Resource | Spec |
|---|---|
| VPS | 8 vCPU, 16 GB RAM, 160 GB NVMe SSD |
| OS | Ubuntu 24.04 LTS |
| Region | Mumbai (for India-lowest latency) |
| Provider | Hostinger VPS / DigitalOcean / Hetzner |

### 1.2 External accounts

- [ ] Domain (`vaani.ai`) with DNS access.
- [ ] Razorpay account (live key + webhook secret).
- [ ] Vobiz account (telephony API token + DID provisioning).
- [ ] Sarvam AI account (API key for STT + TTS).
- [ ] OpenRouter account (API key for LLM).
- [ ] Google OAuth app (client ID + secret for SSO).
- [ ] SMTP credentials (for transactional email).
- [ ] Off-site backup storage (AWS S3 / Backblaze B2).

### 1.3 Local tools

- [ ] Docker + Docker Compose
- [ ] `git`, `curl`, `jq`
- [ ] `mc` (MinIO client)
- [ ] `aws` CLI (for backups)

---

## 2. Initial Server Setup

```bash
# 1. SSH in as root
ssh root@SERVER_IP

# 2. Create deploy user
adduser vaani
usermod -aG sudo vaani
mkdir -p /home/vaani/.ssh
cp ~/.ssh/authorized_keys /home/vaani/.ssh/
chown -R vaani:vaani /home/vaani/.ssh
chmod 700 /home/vaani/.ssh

# 3. Disable root SSH login
sed -i 's/^PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd

# 4. Update system
apt update && apt upgrade -y
apt install -y docker.io docker-compose-v2 git ufw fail2ban curl jq

# 5. Firewall — only allow SSH, HTTP, HTTPS
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable

# 6. Auto-updates + reboot
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades

# 7. Swap (for memory-headroom)
fallocate -l 4G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

---

## 3. Application Deployment

### 3.1 Clone and configure

```bash
sudo -u vaani -i
cd /home/vaani
git clone https://github.com/techlitinc-dev/voice_agent.git
cd voice_agent/vaani-ai

# Create production env file (from template — fill in all values)
cp .env.example .env
nano .env
```

### 3.2 Environment variables checklist

```env
# Core
NODE_ENV=production
NEXTAUTH_URL=https://app.vaani.ai
NEXT_PUBLIC_APP_URL=https://app.vaani.ai

# Database
DATABASE_URL=postgresql://vaani:STRONG_PASSWORD@localhost:5432/vaani?schema=public
POSTGRES_USER=vaani
POSTGRES_PASSWORD=STRONG_PASSWORD
POSTGRES_DB=vaani

# Redis
REDIS_URL=redis://:STRONG_PASSWORD@localhost:6379/0

# JWT (generate with: openssl genrsa -out private.pem 2048)
JWT_SIGNING_KEY_V2="-----BEGIN RSA PRIVATE KEY-----\n..."
JWT_ACTIVE_KEY_VERSION=V2

# MinIO
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=vaani
MINIO_SECRET_KEY=STRONG_PASSWORD
MINIO_BUCKET=vaani-recordings

# Razorpay
RAZORPAY_KEY_ID=rzp_live_xxx
RAZORPAY_KEY_SECRET=xxx
RAZORPAY_WEBHOOK_SECRET=xxx

# Voice providers
VOBIZ_API_TOKEN=xxx
SARVAM_API_KEY=xxx
OPENROUTER_API_KEY=xxx

# Dograh
DOGRAH_API_URL=http://localhost:8001
DOGRAH_API_KEY=xxx

# Google SSO
GOOGLE_OAUTH_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=xxx

# Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=alerts@vaani.ai
SMTP_PASSWORD=xxx

# Observability
NEXT_PUBLIC_SENTRY_DSN=https://xxx@sentry.io/xxx
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

### 3.3 Build and start

```bash
# Build images
docker compose -f docker-compose.prod.yml build

# Start infrastructure first
docker compose -f docker-compose.prod.yml up -d postgres redis minio

# Wait for healthy
until docker compose exec postgres pg_isready; do sleep 2; done

# Run migrations
docker compose run --rm web npx prisma migrate deploy
docker compose run --rm web npx prisma db seed

# Start all services
docker compose -f docker-compose.prod.yml up -d

# Verify
curl http://localhost:3000/api/health/deep
```

### 3.4 TLS via Caddy

The repo has a `Caddyfile`. Edit it for your domain:

```Caddyfile
# vaani-ai/Caddyfile
app.vaani.ai {
    reverse_proxy localhost:3000
    encode gzip zstd
    log {
        output file /var/log/caddy/vaani.log
        format json
    }
}
```

```bash
# Start Caddy (auto-provisions Let's Encrypt cert)
docker compose -f docker-compose.prod.yml up -d caddy

# Verify TLS
curl -I https://app.vaani.ai
```

### 3.5 DNS configuration

```
# A records
app.vaani.ai        → SERVER_IP
api.vaani.ai        → SERVER_IP  (if using separate API subdomain)
www.vaani.ai        → SERVER_IP  (redirects to app)

# MX (for transactional email)
vaani.ai            → MX smtp provider

# TXT (SPF, DKIM, DMARC per your email provider)
vaani.ai            → "v=spf1 include:_spf.provider.com ~all"
```

---

## 4. CI/CD Pipeline

### 4.1 GitHub Actions workflow

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]
    tags: ['v*']
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm, cache-dependency-path: vaani-ai/package-lock.json }
      - run: cd vaani-ai && npm ci
      - run: cd vaani-ai && npm run lint
      - run: cd vaani-ai && npm run typecheck
      - run: cd vaani-ai && npm test
      - run: cd vaani-ai && npm run build

  build-and-push:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/v')
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          context: ./vaani-ai
          push: true
          tags: |
            ghcr.io/${{ github.repository }}/vaani-web:latest
            ghcr.io/${{ github.repository }}/vaani-web:${{ github.sha }}

  deploy:
    needs: build-and-push
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to VPS
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.PROD_HOST }}
          username: vaani
          key: ${{ secrets.PROD_SSH_KEY }}
          script: |
            cd /home/vaani/voice_agent/vaani-ai
            git fetch --all
            git checkout --force ${GITHUB_SHA}
            export IMAGE_TAG=${GITHUB_SHA}
            docker compose -f docker-compose.prod.yml pull
            docker compose -f docker-compose.prod.yml up -d
            docker compose exec -T web npx prisma migrate deploy
            curl -fsS http://localhost:3000/api/health/ready || exit 1
```

### 4.2 Zero-downtime deploy (rolling)

Use the existing `scripts/rolling_update.sh` pattern:

```bash
#!/bin/bash
# Rolling update: one web container at a time
set -euo pipefail

NEW_TAG="${1:-latest}"
INSTANCES=2

for i in $(seq 1 $INSTANCES); do
  echo "Updating web-$i..."
  docker compose -f docker-compose.prod.yml up -d --no-deps --force-recreate web-$i
  # Wait for healthy
  until curl -fsS "http://localhost:300$i/api/health/ready" > /dev/null; do
    echo "  waiting for web-$i..."
    sleep 2
  done
  echo "  web-$i healthy ✓"
done
```

### 4.3 Rollback procedure

```bash
# Rollback to previous image tag
export IMAGE_TAG=<previous-git-sha>
docker compose -f docker-compose.prod.yml up -d

# Rollback a DB migration (CAUTION — may cause data loss)
docker compose exec web npx prisma migrate resolve --rolled-back <migration_name>
```

---

## 5. Configuration Management

### 5.1 Database tuning

```sql
-- /etc/postgresql/16/main/conf.d/vaani.conf
shared_buffers = 4GB              # 25% of RAM
effective_cache_size = 12GB       # 75% of RAM
maintenance_work_mem = 1GB
work_mem = 64MB
max_connections = 200
random_page_cost = 1.1            # SSD
effective_io_concurrency = 200    # SSD
log_min_duration_statement = 1000 -- log queries > 1s
```

### 5.2 Kernel tuning

```bash
# /etc/sysctl.d/99-vaani.conf
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
vm.overcommit_memory = 1          # for Redis background save
fs.file-max = 1000000

sysctl -p /etc/sysctl.d/99-vaani.conf
```

### 5.3 Docker logging

Limit log size to prevent disk fill:

```json
// /etc/docker/daemon.json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "50m", "max-file": "5" }
}
```

---

## 6. Post-Deployment Verification

### 6.1 Smoke test checklist

Run this **immediately** after every deploy:

- [ ] `curl https://app.vaani.ai/api/health/deep` → 200
- [ ] Login with a test account → success
- [ ] Dashboard loads with stats
- [ ] Create a test agent → appears in list
- [ ] Upload a knowledge doc → status PENDING → INDEXED
- [ ] Make a test inbound call → call recorded
- [ ] View call detail page → transcript + recording play
- [ ] Wallet top-up flow → payment page → success
- [ ] Webhook delivery → test subscription receives event
- [ ] `/api/v1/calls` with API key → returns list
- [ ] Cron jobs scheduled (`docker compose exec worker tsx src/worker/cron.ts --dry-run`)

### 6.2 Monitor first 24h

- [ ] Grafana dashboards populated (no missing data)
- [ ] No Sentry errors above baseline
- [ ] Loki logs flowing (search for `level=error`)
- [ ] Prometheus scraping `/metrics` successfully
- [ ] Backup cron ran (check `s3://vaani-backups/postgres/`)
- [ ] No disk full warnings

---

## 7. Routine Operations

### Weekly

- [ ] Review Grafana anomalies
- [ ] Review Sentry error trends
- [ ] Verify backups restored successfully (random sample)
- [ ] Review slow query log
- [ ] Apply security updates (`apt update && apt upgrade`)

### Monthly

- [ ] Rotate JWT signing key (create V(n+1), verify V(n), switch ACTIVE)
- [ ] Review dependency updates (`npm outdated`)
- [ ] Review audit log for suspicious activity
- [ ] Test failover (if HA)
- [ ] Review disk usage trend; plan capacity

### Quarterly

- [ ] Full DR drill (see [04-disaster-recovery §5](04-disaster-recovery.md#5-disaster-recovery-drills))
- [ ] Penetration test / security review
- [ ] Review and update this runbook
- [ ] Cost optimization review (are we over/under-provisioned?)

---

## 8. Emergency Contacts

| Role | Primary | Secondary |
|---|---|---|
| On-call engineer | PagerDuty rotation | — |
| DevOps lead | <name, phone> | <name, phone> |
| Hosting provider support | Hostinger/DO ticket | — |
| Razorpay support | <account manager> | <phone> |
| Vobiz support | <account manager> | <phone> |

---

## Checklist: Go-Live Gate

Before declaring "production-ready", **all** must be checked:

- [ ] All items in [01-hardening](01-hardening-and-security.md) addressed
- [ ] Observability stack running ([02](02-observability-and-monitoring.md))
- [ ] Load test passed ([03 §6](03-scalability-and-performance.md#6-load-testing))
- [ ] Backups running + DR drill passed ([04](04-disaster-recovery.md))
- [ ] Smoke tests pass ([§6.1](#61-smoke-test-checklist))
- [ ] TLS valid (A+ on ssllabs.com)
- [ ] DNS correct (app, api, MX, SPF, DKIM)
- [ ] All secrets in Vault/SSM (not in `.env` file in prod)
- [ ] Rate limiting active on all endpoints
- [ ] Security headers present (check securityheaders.com)
- [ ] Audit log capturing all categories
- [ ] Status page live at `/status`
- [ ] Incident response runbook documented
- [ ] First on-call shift scheduled

---

← Back to [Production Readiness](../README.md#production-readiness) | [CRM Features →](../crm-features/01-data-model-and-migrations.md)