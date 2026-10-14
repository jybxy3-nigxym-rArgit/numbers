#!/usr/bin/env bash
# Installs Numbers Market on a fresh Ubuntu or Debian server. Run as root.
#
# What it does:
#   1. installs Node 22, Caddy (automatic HTTPS) and git
#   2. downloads the site into /opt/numbers and runs it as a service
#   3. opens ports 80 and 443 in the server's own firewall
#   4. takes a database backup every day (kept for 14 days)
#
# Settings come from /root/numbers.conf (see cloud-init.yaml) or from the environment:
#   ADMIN_PHONE       required. The phone that becomes the admin account.
#   REQUIRE_APPROVAL  optional. true = new ads wait for approval. Default false.
#   DOMAIN            optional. Without it the site uses a free name like 140-12-34-56.sslip.io.
#   REPO_URL          optional. Where to download the site from.
#
# Safe to run again: it updates the code and restarts the service.

set -euo pipefail

if [ -f /root/numbers.conf ]; then
  set -a
  # shellcheck disable=SC1091
  . /root/numbers.conf
  set +a
fi

REPO_URL="${REPO_URL:-https://github.com/jybxy3-nigxym-rArgit/numbers.git}"
APP_DIR=/opt/numbers
DATA_DIR=/var/lib/numbers
BACKUP_DIR=/var/backups/numbers
REQUIRE_APPROVAL="${REQUIRE_APPROVAL:-false}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root." >&2
  exit 1
fi
if [ -z "${ADMIN_PHONE:-}" ]; then
  echo "ADMIN_PHONE is missing. Set it in /root/numbers.conf." >&2
  exit 1
fi

say() { echo; echo "==> $*"; }
export DEBIAN_FRONTEND=noninteractive

# ---- Memory: small servers need a swap file so installs do not run out of RAM ----
if [ -z "$(swapon --show --noheadings)" ]; then
  say "Adding a 1 GB swap file"
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ---- Packages ----
say "Installing base packages"
apt-get update -y
echo iptables-persistent iptables-persistent/autosave_v4 boolean true | debconf-set-selections
echo iptables-persistent iptables-persistent/autosave_v6 boolean true | debconf-set-selections
apt-get install -y curl git ca-certificates gnupg apt-transport-https iptables iptables-persistent

node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
if [ "$(node_major)" -lt 22 ]; then
  say "Installing Node 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null 2>&1; then
  say "Installing Caddy"
  apt-get install -y debian-keyring debian-archive-keyring
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

# ---- The site ----
say "Downloading the site"
id numbers >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin numbers
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone --depth 1 "$REPO_URL" "$APP_DIR"
fi
mkdir -p "$DATA_DIR" "$BACKUP_DIR"
chown -R numbers:numbers "$DATA_DIR" "$BACKUP_DIR"

# ---- Address ----
if [ -z "${DOMAIN:-}" ]; then
  IP="$(curl -fsS https://api.ipify.org || curl -fsS https://ifconfig.me)"
  DOMAIN="${IP//./-}.sslip.io"
fi
say "Site address: https://$DOMAIN"

# ---- Service ----
cat > /etc/numbers.env <<EOF
NODE_ENV=production
PORT=3000
HOST=127.0.0.1
DATA_DIR=$DATA_DIR
BASE_URL=https://$DOMAIN
ADMIN_PHONE=$ADMIN_PHONE
REQUIRE_APPROVAL=$REQUIRE_APPROVAL
TRUSTED_HOPS=1
EOF
chown root:numbers /etc/numbers.env
chmod 640 /etc/numbers.env

cat > /etc/systemd/system/numbers.service <<'EOF'
[Unit]
Description=Numbers Market
After=network-online.target
Wants=network-online.target

[Service]
User=numbers
Group=numbers
WorkingDirectory=/opt/numbers
EnvironmentFile=/etc/numbers.env
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/numbers

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
    encode gzip zstd
    reverse_proxy 127.0.0.1:3000
}
EOF

# ---- Daily backup ----
cat > /etc/cron.daily/numbers-backup <<'EOF'
#!/bin/sh
cd /opt/numbers || exit 1
exec runuser -u numbers -- env DATA_DIR=/var/lib/numbers BACKUP_DIR=/var/backups/numbers \
  /usr/bin/node --disable-warning=ExperimentalWarning deploy/backup.js
EOF
chmod 755 /etc/cron.daily/numbers-backup

# ---- Firewall (many cloud images block web ports by default) ----
say "Opening ports 80 and 443"
for port in 80 443; do
  iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
done
netfilter-persistent save >/dev/null 2>&1 || true

# ---- Start ----
say "Starting"
systemctl daemon-reload
systemctl enable numbers >/dev/null 2>&1
systemctl restart numbers
systemctl enable caddy >/dev/null 2>&1
systemctl restart caddy

for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/healthz >/dev/null 2>&1; then
    OK=1
    break
  fi
  sleep 1
done

if [ "${OK:-0}" = "1" ]; then
  echo "Site is running: https://$DOMAIN" | tee /root/numbers-ready.txt
  echo "Register right away with $ADMIN_PHONE to claim the admin account." | tee -a /root/numbers-ready.txt
else
  echo "The site did not answer. Check: journalctl -u numbers -n 50" >&2
  exit 1
fi
