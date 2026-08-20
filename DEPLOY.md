# `novbesistemi.ixlastelecom.az` üçün VPS quraşdırması

## 0. DNS qeydi

`ixlastelecom.az` DNS idarəetmə panelində aşağıdakı qeydi yarat:

| Tip | Host | Dəyər |
|-----|------|-------|
| `A` | `novbesistemi` | VPS-in public IP ünvanı |

DNS yayıldıqdan sonra yoxla:

```bash
nslookup novbesistemi.ixlastelecom.az
```
# VPS Deployment Guide

## 1. VPS Server Quraşdırması

### SSH bağlantısı:
```bash
ssh -p PORT user@SERVER_IP
```

### Node.js quraşdırması:
```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Versiyası yoxla
node --version
npm --version
```

### PM2 quraşdırması (proses meneceri):
```bash
sudo npm install -g pm2

# Startup'a əlavə et
pm2 startup
# Göstərilən əmri çalıştır
pm2 save
```

### Nginx quraşdırması (reverse proxy):
```bash
sudo apt-get install -y nginx

# Sitə konfigurasiyanı yarad
sudo nano /etc/nginx/sites-available/novbesistemi.ixlastelecom.az
```

Repository-dəki `nginx/novbesistemi.ixlastelecom.az.conf` məzmununu həmin fayla yerləşdir:

```nginx
```nginx
server {
    listen [::]:80;
    server_name novbesistemi.ixlastelecom.az;

    server_name your-domain.com;
        proxy_pass http://127.0.0.1:3000;
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Connection "upgrade";
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600;
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
```

Repository serverdə `/home/user/queue-system` qovluğundadırsa, Nginx və SSL quraşdırmasını
hazır skriptlə də edə bilərsən:

```bash
cd /home/user/queue-system
chmod +x deploy/setup-domain.sh
./deploy/setup-domain.sh /home/user/queue-system
```
    }
}
```
sudo ln -s /etc/nginx/sites-available/novbesistemi.ixlastelecom.az /etc/nginx/sites-enabled/
Aktivləşdir:
```bash
sudo ln -s /etc/nginx/sites-available/queue-system /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### SSL sertifikatı (Let's Encrypt):
```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d novbesistemi.ixlastelecom.az
sudo systemctl restart nginx
```

Yoxla:

```bash
curl -f https://novbesistemi.ixlastelecom.az/health
```

Gözlənilən cavab: `{"status":"ok"}`.

---

## 2. GitHub Secrets Quraşdırması

GitHub Repository → Settings → Secrets and variables → Actions

Aşağıdakıları əlavə et:

| Secret | Dəyər |
|--------|-------|
| `SERVER_HOST` | VPS IP adresi |
| `SERVER_USER` | SSH username |
| `SERVER_PORT` | SSH port (adətən 22) |
| `SERVER_SSH_KEY` | Private SSH key |
| `APP_PATH` | Serverdəki app qovluğu (məs: `/home/user/queue-system`) |

### SSH Key Yaratma:
```bash
# Yerli komputerində:
ssh-keygen -t ed25519 -C "github@queue-system"
# Şifrə qoşma (istəyə bağlı)

# Public key-i servere əlavə et
ssh-copy-id -i ~/.ssh/id_ed25519.pub user@SERVER_IP

# Private key-i GitHub Secret-ə kopyala
cat ~/.ssh/id_ed25519
# Bütün mətni kopyala
```

---

## 3. Server-ə İlk Dəfə Deploy

```bash
# Server-ə gir
ssh -p PORT user@SERVER_IP

# App qovluğu yarad
mkdir -p /home/user/queue-system
cd /home/user/queue-system

# Repository klonla (`main` və ya `master` branch-i ilə)
git clone -b main https://github.com/YOUR_USERNAME/queue-system.git .

# Dependencies quraş
npm ci

# Environment faylı yarad
printf "NODE_ENV=production\nPORT=3000\n" > .env

# PM2 ilə başlat
pm2 start server.js --name queue-system
pm2 save
```

---

## 4. Sonrakı Push-lar

Artıq `git push` etdikdə GitHub Actions avtomatik olarak:
1. `main` və ya `master` branch-indəki son kodu serverə gətirəcək
2. `npm ci --omit=dev` icra edəcək
3. Tətbiqi PM2 ilə `--update-env` parametrindən istifadə edərək yenidən başlayacaq

Workflow-un işləməsi üçün repository-də `.github/workflows/deploy.yml` faylı olmalıdır.
Serverdəki qovluq əvvəlcədən repository-nin klonu olmalı və `APP_PATH` həmin qovluğu göstərməlidir.

Deployment status-u GitHub Actions tapmində görə bilərsən.

İşlək ünvanlar:

- Admin: `https://novbesistemi.ixlastelecom.az/admin`
- Monitor: `https://novbesistemi.ixlastelecom.az/monitor`
- Masalar: `https://novbesistemi.ixlastelecom.az/desk/1` - `/desk/5`

---

## 5. Faydalı PM2 Əmrləri

```bash
# Prosesləri göstər
pm2 list

# Log göstər
pm2 logs queue-system

# Prosesin status-u
pm2 status

# Prosesin durdurması
pm2 stop queue-system

# Yenidən başlat
pm2 restart queue-system

# Sil
pm2 delete queue-system
```

---

## 6. Firewall Quraşdırması

```bash
sudo ufw allow 22
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

---

## Problemlər?

- **Port artıq istifadə olunur:** `sudo lsof -i :3000`
- **PM2 işləmir:** `pm2 install pm2-auto-pull`
- **SSH bağlantısı kopiyalar:** SSH keep-alive əlavə et

Hər hansı sual varsa, GitHub Issues-ə yaz!
