# Deploying Dev Project Tracker to AWS EC2

This guide gets the app running on a single Amazon EC2 Ubuntu server, reachable on
the public internet at `http://<your-server-ip>/`, with the SQLite database stored on
the instance's disk. It matches these choices: **EC2 · public internet + admin login ·
IP address over HTTP** (an optional HTTPS upgrade is at the end).

Because the app uses a single SQLite file with file locking, it runs on **one always-on
instance** — do not put it behind an autoscaling group or load balancer with multiple
instances.

> ⚠️ **Security note (please read).** With plain HTTP, the admin username/password are
> sent **unencrypted** over the network. Two things are non‑negotiable before you share
> the URL: (1) change `ADMIN_PASS` from the default, and (2) seriously consider the
> 5‑minute HTTPS upgrade in the last section — it needs no domain purchase and protects
> that password. Viewing the dashboard is open to anyone with the URL; only editing needs
> the login.

---

## What you'll end up with

- An Ubuntu 22.04 EC2 instance (region: Mumbai `ap-south-1` suggested, since you're in India).
- Node.js 22 running the app as a **systemd service** (auto-starts on boot, auto-restarts on crash).
- **nginx** in front, so the app is served on the normal port **80** (`http://IP/`) instead of `:3000`.
- A **daily backup** of the database.

Total cost: a `t3.micro` is free-tier eligible for the first 12 months on a new account,
otherwise roughly $8–10/month plus a few cents for storage.

---

## Step 1 — Launch the EC2 instance

1. In the AWS Console, top-right, set your region to **Asia Pacific (Mumbai) ap-south-1**.
2. Go to **EC2 → Instances → Launch instances**.
3. **Name:** `dev-project-tracker`.
4. **AMI:** *Ubuntu Server 22.04 LTS* (64-bit x86).
5. **Instance type:** `t3.micro` (fine for a small team; bump to `t3.small` if you expect heavy use).
6. **Key pair:** create a new key pair (e.g. `dev-tracker-key`), type **RSA / .pem**, and download it.
   Keep the `.pem` file safe — you need it to SSH in.
7. **Network settings → Firewall (security group):** create a new security group and add these
   inbound rules:
   - **SSH**, TCP **22**, Source **My IP** (so only you can SSH in).
   - **HTTP**, TCP **80**, Source **Anywhere `0.0.0.0/0`** (so the team can reach the app).
   - (Leave port 3000 closed — nginx talks to it internally.)
8. **Storage:** 8 GB is enough; 20 GB gives comfortable headroom. Keep the default gp3 volume.
9. Click **Launch instance**.

### Give it a stable IP (recommended)
By default the public IP changes if the instance stops/starts. Reserve a fixed one:

1. **EC2 → Elastic IPs → Allocate Elastic IP address → Allocate**.
2. Select it → **Actions → Associate** → choose your instance → **Associate**.

Note this Elastic IP — that's your app's address. We'll call it `SERVER_IP` below.

---

## Step 2 — Connect to the instance

From your Windows machine, open **PowerShell** in the folder containing your `.pem` key.

```powershell
# Lock down the key file permissions (first time only)
icacls .\dev-tracker-key.pem /inheritance:r
icacls .\dev-tracker-key.pem /grant:r "$($env:USERNAME):(R)"

# Connect (username for Ubuntu AMIs is 'ubuntu')
ssh -i .\dev-tracker-key.pem ubuntu@SERVER_IP
```

Type `yes` at the fingerprint prompt. You're now on the server.

---

## Step 3 — Upload the app

Pick **one** of these. Run these on your **Windows PowerShell**, not on the server.

### Option A — Copy the folder directly with scp (simplest)

```powershell
# From inside the project folder on your PC:
cd "D:\Yash\JS App\Dev project tracker\Software\R1_Dev project tracker"

# Copy everything to the server's home dir (exclude local build/data cruft if any)
scp -i C:\path\to\dev-tracker-key.pem -r . ubuntu@SERVER_IP:/home/ubuntu/dev-tracker
```

Then, **on the server**, move it into place:

```bash
sudo mkdir -p /opt/dev-tracker
sudo cp -r /home/ubuntu/dev-tracker/. /opt/dev-tracker/
```

### Option B — Via GitHub (nice for future updates)

Push the project to a private GitHub repo, then on the server:

```bash
sudo apt-get update && sudo apt-get install -y git
sudo git clone https://github.com/<you>/<repo>.git /opt/dev-tracker
```

> Do **not** copy any existing `node_modules` from Windows — the app has no dependencies,
> so there shouldn't be one. If a leftover `node_modules` exists, it's harmless but you can delete it.

---

## Step 4 — Run the automated setup

The repo includes a bootstrap script that installs Node 22, nginx and sqlite3, and wires
up the service and reverse proxy. On the **server**:

```bash
sudo bash /opt/dev-tracker/deploy/setup.sh
```

When it finishes, **set a strong admin password**:

```bash
sudo nano /etc/systemd/system/dev-tracker.service
```

Change this line to your own password (and username if you like):

```
Environment=ADMIN_PASS=CHANGE_ME_TO_A_STRONG_PASSWORD
```

Save (Ctrl+O, Enter, Ctrl+X), then apply:

```bash
sudo systemctl daemon-reload
sudo systemctl restart dev-tracker
```

Check it's healthy:

```bash
systemctl status dev-tracker --no-pager
```

You should see `active (running)`. Now open **`http://SERVER_IP/`** in a browser — the
dashboard should load. Log in with the username/password you set to add projects.

<details>
<summary>Prefer to do it manually instead of the script? Expand.</summary>

```bash
# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs nginx sqlite3

# App location + ownership
sudo mkdir -p /opt/dev-tracker/data
sudo chown -R ubuntu:ubuntu /opt/dev-tracker

# systemd service
sudo cp /opt/dev-tracker/deploy/dev-tracker.service /etc/systemd/system/dev-tracker.service
sudo nano /etc/systemd/system/dev-tracker.service      # set ADMIN_PASS
sudo systemctl daemon-reload
sudo systemctl enable --now dev-tracker

# nginx reverse proxy
sudo cp /opt/dev-tracker/deploy/nginx-dev-tracker.conf /etc/nginx/sites-available/dev-tracker
sudo ln -sf /etc/nginx/sites-available/dev-tracker /etc/nginx/sites-enabled/dev-tracker
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx
```
</details>

---

## Step 5 — (Optional) Load sample data

If you want demo projects to explore (skip this for a clean production start):

```bash
cd /opt/dev-tracker && node seed.js
```

---

## Step 6 — Set up daily backups

The database is the file `/opt/dev-tracker/data/tracker.db`. Schedule a safe daily copy:

```bash
sudo crontab -e
```

Add this line (backs up at 3am, keeps the last 30 copies in `/opt/dev-tracker/backups`):

```
0 3 * * * /bin/bash /opt/dev-tracker/deploy/backup.sh >> /var/log/dev-tracker-backup.log 2>&1
```

To copy a backup to your PC later:

```powershell
scp -i C:\path\to\dev-tracker-key.pem ubuntu@SERVER_IP:/opt/dev-tracker/backups/tracker-YYYYMMDD-HHMMSS.db .
```

For extra safety you can also take an **EBS snapshot** of the volume from the EC2 console
now and then, or sync backups to S3.

---

## Everyday operations

```bash
# View logs (live)
journalctl -u dev-tracker -f

# Restart / stop / start
sudo systemctl restart dev-tracker
sudo systemctl stop dev-tracker
sudo systemctl start dev-tracker

# Check nginx
sudo nginx -t && sudo systemctl reload nginx
```

### Updating the app after code changes
Upload the changed files (Step 3) into `/opt/dev-tracker`, then:

```bash
sudo systemctl restart dev-tracker
```

The database in `data/` is preserved across updates and restarts. (Note: because admin
login tokens are kept in memory, a restart logs admins out — just log in again.)

---

## Optional but recommended — Add HTTPS in ~5 minutes (no domain needed)

Plain HTTP means the admin password is sent in the clear. You can get real, trusted
HTTPS **without buying a domain** using a free wildcard-DNS hostname (`nip.io`) that maps
to your IP, plus **Caddy**, which fetches a Let's Encrypt certificate automatically.

Your hostname will be `SERVER_IP-with-dashes.nip.io` — e.g. if `SERVER_IP` is
`13.234.56.78`, the hostname is `13-234-56-78.nip.io`.

1. In the EC2 security group, **add inbound HTTPS, TCP 443, Source `0.0.0.0/0`**
   (Caddy also needs port 80 open, which you already have).
2. On the server, stop nginx (Caddy will take over ports 80/443):
   ```bash
   sudo systemctl disable --now nginx
   ```
3. Install Caddy:
   ```bash
   sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
   sudo apt-get update && sudo apt-get install -y caddy
   ```
4. Configure Caddy — replace the hostname with your own:
   ```bash
   sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
   13-234-56-78.nip.io {
       reverse_proxy 127.0.0.1:3000
   }
   EOF
   sudo systemctl restart caddy
   ```
5. Visit **`https://13-234-56-78.nip.io/`** — you now have a valid TLS padlock.

> Caveat: `nip.io` is shared and Let's Encrypt applies rate limits to it, so issuance can
> occasionally be slow or throttled. For a permanent setup, a cheap real domain (e.g. from
> Route 53 or any registrar, ~$1–12/yr) pointed at `SERVER_IP` works the same way and is
> more robust — just put that domain in the Caddyfile instead.

---

## Troubleshooting

- **Browser can't connect:** confirm the security group allows port **80** from `0.0.0.0/0`,
  and `systemctl status dev-tracker` shows `active (running)`.
- **502 Bad Gateway from nginx:** the Node service isn't running — check `journalctl -u dev-tracker -e`.
- **"node: command not found" or SQLite error:** Node must be **v22.5+**. Check with `node -v`;
  re-run the NodeSource install if it's older.
- **Login fails:** the password is whatever you set in `ADMIN_PASS`; after editing the service
  file you must `sudo systemctl daemon-reload && sudo systemctl restart dev-tracker`.
