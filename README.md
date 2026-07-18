# SwapProxy v2 — Per-Request Rotating Proxy Platform

```
SwapProxy/
├── docker-compose.yml       # Multi-container (VPS)
├── Dockerfile               # All-in-one container (Render / Fly.io)
├── fly.toml                 # Fly.io deployment config
├── render.yaml              # Render Blueprint config
├── fly-entrypoint.sh        # Starts Redis + Scylla + engine
├── config/
│   └── users.json           # Authorized users + bandwidth quotas
├── engine/
│   ├── package.json
│   ├── server.js            # Proxy gateway (auth, rotation, fallback)
│   ├── proxy-pool.js        # Multi-source fetcher + health checker + scorer
│   └── anti-detect.js       # Fingerprint forgery (UA, headers, etc.)
├── examples/
│   └── scraper.py           # Playwright integration example
└── scripts/
    └── healthcheck.sh       # Docker health check
```

---

## نشر على Render (مجاني)

### 1. ارفع المشروع على GitHub

```bash
cd SwapProxy

# أنشئ repo عام
gh repo create swaproxy --public --push
# أو يدوي:
git init
git add .
git commit -m "first"
# ارفع لمشروعك على GitHub
```

### 2. افتح Render

- [dashboard.render.com](https://dashboard.render.com) ← **New** ← **Blueprint**
- Connect GitHub repo
- Render بيقرأ `render.yaml` ويسألك: اختار **Web Service**
- خل الإعدادات زي ما هي واضغط **Apply**

### 3. انتظر 3-5 دقائق

بعد ما ينتهي Build، افتح الـ URL:

```
https://swapproxy-engine.onrender.com
```

### 4. اختبر

```bash
curl -x "http://demo:swapproxy2024@swapproxy-engine.onrender.com:3128" \
  https://httpbin.org/ip
```

### ⚠️ مهم: منع الـ Sleep

Render المجاني يطفّي الخدمة بعد 15 دقيقة. عشان يظل شغال:

- استخدم **cron-job.org** مجاناً: أضف مهمة كل 5 دقائق ترسل `GET` لموقعك
- أو سجل في **UptimeRobot** (مجاني)

---

## نشر على Fly.io (مجاني)

```bash
fly launch --no-deploy
fly deploy
fly certs create swapproxy.com
fly certs create *.swapproxy.com
# أضف DNS records اللي يطلعها الأمر
```

---

## نشر على VPS (Docker Compose)

```bash
# Ubuntu
sudo apt update && sudo apt install docker.io docker-compose-plugin -y

cd ~/swapproxy
sudo docker compose up -d --build

# اختبر
curl -x "http://demo:swapproxy2024@YOUR_VPS_IP:3128" https://httpbin.org/ip

# loop rotation
for i in {1..5}; do
  echo "$i: $(curl -s -x "http://demo:swapproxy2024@YOUR_VPS_IP:3128" https://httpbin.org/ip)"
done
```

---

## الاختبار النهائي

```bash
# كل request يطلع IP مختلف
curl -x "http://demo:swapproxy2024@YOUR_DOMAIN:3128" https://httpbin.org/ip

# Python
pip install requests
python -c "
import requests
r = requests.get('https://httpbin.org/ip',
    proxies={'http': 'http://demo:swapproxy2024@YOUR_DOMAIN:3128',
             'https': 'http://demo:swapproxy2024@YOUR_DOMAIN:3128'})
print(r.json())
"

# Playwright (للمواقع الصعبة)
python examples/scraper.py https://target.com
```

---

## متغيرات البيئة

| المتغير | الافتراضي | الوصف |
|---|---|---|
| `PROXY_PORT` | `3128` | منفذ الاستقبال |
| `REQUEST_TIMEOUT_MS` | `30000` | مهلة الطلب (30 ثانية) |
| `MAX_RETRIES` | `3` | عدد محاولات إعادة التوجيه |
| `POOL_REFRESH_MS` | `60000` | تحديث قائمة البروكسيات كل 60 ثانية |
| `BANDWIDTH_RESET_DAYS` | `30` | إعادة تعيين الباندويث كل 30 يوم |

---

## المراقبة

```bash
docker logs -f swaproxy-engine
# [pool] geonode: fetched 32 proxies
# [pool] scylla: fetched 47 proxies
# [pool] Health check done: 42/107 alive, avg 1240ms
```
