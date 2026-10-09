#!/bin/bash
# ==============================================================================
# Complete Clean Setup & Deployment Script for Ahaalo Platform
# Server IP: 13.220.177.105
# Subdomains: api.ahaalo.com | app.ahaalo.com | admin.ahaalo.com
# ==============================================================================

set -e

echo "--------------------------------------------------------"
echo "Step 1: Purana Code / Previous Deployment Clean Up"
echo "--------------------------------------------------------"
pm2 kill || true
sudo rm -rf /var/www/ahaalo-frontend /var/www/ahaalo-superadmin /var/www/html/*
rm -rf ~/backend ~/Frontend ~/SuperAdmin ~/Ahaalo-software

echo "--------------------------------------------------------"
echo "Step 2: Installing System Requirements (Node.js 20, Nginx, PM2, Git)"
echo "--------------------------------------------------------"
sudo apt-get update -y
sudo apt-get install -y nginx curl git

if ! command -v node &> /dev/null; then
    echo "Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

if ! command -v pm2 &> /dev/null; then
    echo "Installing PM2 globally..."
    sudo npm install -g pm2
fi

echo "--------------------------------------------------------"
echo "Step 3: Cloning Fresh Code repositories from GitHub"
echo "--------------------------------------------------------"
cd ~
git clone https://github.com/aquiiibbb/backend-repository.git backend
git clone https://github.com/aquiiibbb/frontend--repository.git Frontend
git clone https://github.com/aquiiibbb/admin-repository.git SuperAdmin

echo "--------------------------------------------------------"
echo "Step 4: Setting up Backend (api.ahaalo.com)"
echo "--------------------------------------------------------"
cd ~/backend
if [ -f ".env.production" ]; then
    cp .env.production .env
elif [ -f ".env.example" ]; then
    cp .env.example .env
fi
npm install --production
pm2 delete ahaalo-backend || true
pm2 start server.js --name "ahaalo-backend" --env production
pm2 save

echo "--------------------------------------------------------"
echo "Step 5: Building Frontend App (app.ahaalo.com)"
echo "--------------------------------------------------------"
cd ~/Frontend
npm install
npm run build
sudo mkdir -p /var/www/ahaalo-frontend
sudo cp -r dist/* /var/www/ahaalo-frontend/

echo "--------------------------------------------------------"
echo "Step 6: Building SuperAdmin Panel (admin.ahaalo.com)"
echo "--------------------------------------------------------"
cd ~/SuperAdmin
npm install
npm run build
sudo mkdir -p /var/www/ahaalo-superadmin
sudo cp -r dist/* /var/www/ahaalo-superadmin/

echo "--------------------------------------------------------"
echo "Step 7: Configuring Nginx Server Blocks for Subdomains"
echo "--------------------------------------------------------"
cat << 'EOF' | sudo tee /etc/nginx/sites-available/ahaalo
# 1. BACKEND API: api.ahaalo.com
server {
    listen 80;
    server_name api.ahaalo.com;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}

# 2. FRONTEND APP: app.ahaalo.com
server {
    listen 80;
    server_name app.ahaalo.com;

    root /var/www/ahaalo-frontend;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|mp4)$ {
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }
}

# 3. SUPERADMIN DASHBOARD: admin.ahaalo.com
server {
    listen 80;
    server_name admin.ahaalo.com;

    root /var/www/ahaalo-superadmin;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/ahaalo /etc/nginx/sites-enabled/ahaalo
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

echo "========================================================"
echo "🎉 Clean Setup & Deployment Finished Successfully!"
echo "Backend API:      http://api.ahaalo.com"
echo "Frontend App:     http://app.ahaalo.com"
echo "SuperAdmin Panel: http://admin.ahaalo.com"
echo "========================================================"
