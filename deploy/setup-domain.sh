#!/usr/bin/env bash
set -euo pipefail

APP_PATH="${1:-/home/user/queue-system}"
DOMAIN="novbesistemi.ixlastelecom.az"
NGINX_SITE="/etc/nginx/sites-available/${DOMAIN}"

if [[ ! -f "${APP_PATH}/nginx/${DOMAIN}.conf" ]]; then
    echo "Nginx konfiqurasiyası tapılmadı: ${APP_PATH}/nginx/${DOMAIN}.conf" >&2
    exit 1
fi

sudo apt-get update
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo cp "${APP_PATH}/nginx/${DOMAIN}.conf" "${NGINX_SITE}"
sudo ln -sfn "${NGINX_SITE}" "/etc/nginx/sites-enabled/${DOMAIN}"
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx --non-interactive --agree-tos --redirect \
    --register-unsafely-without-email -d "${DOMAIN}"
sudo nginx -t
sudo systemctl reload nginx

curl -f "https://${DOMAIN}/health"
printf '\nDomain setup completed: https://%s\n' "${DOMAIN}"
