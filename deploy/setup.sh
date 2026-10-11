#!/usr/bin/env bash
# One-time server bootstrap for Dev Project Tracker on Ubuntu 22.04 (EC2).
# Assumes the app files are already at /opt/dev-tracker.
# Run on the instance:   sudo bash /opt/dev-tracker/deploy/setup.sh
set -euo pipefail

APP_DIR=/opt/dev-tracker
SERVICE=dev-tracker

echo "==> Installing Node.js 22 (NodeSource)…"
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "    node $(node -v)"

echo "==> Installing nginx and sqlite3…"
apt-get update -y
apt-get install -y nginx sqlite3

echo "==> Setting ownership of $APP_DIR to ubuntu…"
chown -R ubuntu:ubuntu "$APP_DIR"
mkdir -p "$APP_DIR/data"
chown -R ubuntu:ubuntu "$APP_DIR/data"

echo "==> Installing systemd service…"
cp "$APP_DIR/deploy/dev-tracker.service" "/etc/systemd/system/${SERVICE}.service"
echo "    NOTE: edit /etc/systemd/system/${SERVICE}.service and set a strong ADMIN_PASS."

echo "==> Installing nginx site…"
cp "$APP_DIR/deploy/nginx-dev-tracker.conf" /etc/nginx/sites-available/dev-tracker
ln -sf /etc/nginx/sites-available/dev-tracker /etc/nginx/sites-enabled/dev-tracker
rm -f /etc/nginx/sites-enabled/default
nginx -t

echo "==> Enabling and starting services…"
systemctl daemon-reload
systemctl enable "$SERVICE"
systemctl restart "$SERVICE"
systemctl restart nginx

echo
echo "Done. Check status with:  systemctl status $SERVICE --no-pager"
echo "The app should be reachable on  http://<your-ec2-public-ip>/"
echo "IMPORTANT: set ADMIN_PASS in the service file, then: sudo systemctl restart $SERVICE"
