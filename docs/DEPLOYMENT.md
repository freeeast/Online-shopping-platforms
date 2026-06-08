# ZStore Deployment Guide (Reproduce / Redeploy)

This guide documents a reproducible deployment path from local development to a public cloud VM.

## 1. Local run checklist

1. `cd backend && npm install`
2. `cp .env.example .env`
3. Fill in Stripe and merchant env values
4. `npm start`
5. Visit `http://localhost:3000/index.html`

If startup is successful, you should see:

- backend log: `Server is running on http://localhost:3000`
- SQLite file auto-created: `backend/zstore.db`

## 2. Recommended production architecture

- Nginx: TLS termination + reverse proxy to Node.js
- Node.js process: managed by systemd
- SQLite DB: local file under backend directory
- Stripe webhook: public HTTPS endpoint `/api/payments/webhook`

## 3. VM setup (Ubuntu 22.04/24.04)

Install runtime and web server:

```bash
sudo apt update
sudo apt install -y nginx curl git build-essential
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

## 4. Deploy application code

```bash
cd /var/www
sudo git clone <your-repo-url>.git zstore
sudo chown -R $USER:$USER /var/www/zstore
cd /var/www/zstore/backend
npm install --omit=dev
cp .env.example .env
```

Edit `/var/www/zstore/backend/.env`:

- `STRIPE_SECRET_KEY=...`
- `STRIPE_WEBHOOK_SECRET=...`
- `ZSTORE_MERCHANT_EMAIL=...`
- `PUBLIC_BASE_URL=https://<your-domain>`

## 5. systemd service for Node.js

Create `/etc/systemd/system/zstore.service`:

```ini
[Unit]
Description=ZStore Node.js backend
After=network.target

[Service]
Type=simple
WorkingDirectory=/var/www/zstore/backend
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo chown -R www-data:www-data /var/www/zstore
sudo systemctl daemon-reload
sudo systemctl enable zstore
sudo systemctl start zstore
sudo systemctl status zstore
```

## 6. Nginx reverse proxy

Create `/etc/nginx/sites-available/zstore`:

```nginx
server {
    listen 80;
    server_name <your-domain>;

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable config:

```bash
sudo ln -s /etc/nginx/sites-available/zstore /etc/nginx/sites-enabled/zstore
sudo nginx -t
sudo systemctl reload nginx
```

## 7. Enable HTTPS (Let's Encrypt)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d <your-domain>
```

After HTTPS is active, verify:

- `https://<your-domain>/index.html`
- `https://<your-domain>/api/csrf-token`

## 8. Stripe webhook in production

1. In Stripe dashboard, create webhook endpoint:
   - URL: `https://<your-domain>/api/payments/webhook`
2. Subscribe events:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
3. Copy signing secret to `.env` (`STRIPE_WEBHOOK_SECRET`)
4. Restart service:

```bash
sudo systemctl restart zstore
```

## 9. Post-deploy verification

Functional checks:

- register/login/logout
- admin CRUD for category/product
- cart + checkout redirect
- webhook updates order to paid
- my orders page reflects latest status

Security checks:

- mutating API without CSRF token returns `403`
- `/admin.html` blocked for non-admin
- no `.env` or DB file exposed via URL

## 10. Operations and maintenance

Useful commands:

```bash
sudo systemctl status zstore
sudo journalctl -u zstore -n 200 --no-pager
sudo nginx -t
sudo systemctl reload nginx
```

Upgrade flow:

```bash
cd /var/www/zstore
git pull
cd backend
npm install --omit=dev
sudo systemctl restart zstore
```

Backup suggestion:

- backup `/var/www/zstore/backend/zstore.db`
- backup `/var/www/zstore/backend/.env`
