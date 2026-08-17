#!/usr/bin/env bash
# Fresh-VPS bootstrap (deployment runbook §2). Run as root on Ubuntu 24.04.
# Idempotent — safe to re-run.
#
# Usage: ./scripts/server-setup.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "run as root"; exit 1; fi

DEPLOY_USER="${DEPLOY_USER:-vaani}"
PUBLIC_IP="${PUBLIC_IP:-}"

echo "==> [1/8] system update + base packages"
export DEBIAN_FRONTEND=noninteractive
apt update -y && apt upgrade -y
apt install -y docker.io docker-compose-v2 git ufw fail2ban curl jq gpg awscli unattended-upgrades

echo "==> [2/8] deploy user"
id "$DEPLOY_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$DEPLOY_USER"
usermod -aG sudo "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"
mkdir -p "/home/$DEPLOY_USER/.ssh"
[ -f /root/.ssh/authorized_keys ] && cp /root/.ssh/authorized_keys "/home/$DEPLOY_USER/.ssh/" || true
chown -R "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
chmod 700 "/home/$DEPLOY_USER/.ssh"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys" 2>/dev/null || true

echo "==> [3/8] SSH hardening"
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config
systemctl restart sshd

echo "==> [4/8] firewall (SSH/HTTP/HTTPS only)"
ufw --force default deny incoming
ufw --force default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> [5/8] fail2ban (ssh jail)"
systemctl enable --now fail2ban

echo "==> [6/8] swap (4G)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> [7/8] kernel tuning (deploy/99-vaani.conf)"
cp "$(dirname "$0")/../deploy/99-vaani.conf" /etc/sysctl.d/99-vaani.conf
sysctl -p /etc/sysctl.d/99-vaani.conf

echo "==> [8/8] docker logging limits (deploy/daemon.json)"
mkdir -p /etc/docker
cp "$(dirname "$0")/../deploy/daemon.json" /etc/docker/daemon.json
systemctl restart docker

echo
echo "server setup complete. Next:"
echo "  sudo -u $DEPLOY_USER -i"
echo "  git clone https://github.com/techlitinc-dev/voice_agent.git && cd voice_agent/vaani-ai"
echo "  cp .env.example .env && nano .env"
echo "  docker compose -f docker-compose.prod.yml up -d"
