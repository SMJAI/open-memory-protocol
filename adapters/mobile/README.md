# OMP Mobile

Three ways to use OMP on your phone — no app store required.

---

## 1. Mobile PWA (any phone, any AI app)

Your OMP server serves a mobile-optimised page at `/app`.

**Setup (one time):**

1. Find your PC's local IP address:
   - Windows: open Command Prompt → type `ipconfig` → look for IPv4 Address (e.g. `192.168.1.42`)
   - Mac: System Settings → Wi-Fi → Details → IP Address

2. Make sure your phone is on the same Wi-Fi as your PC

3. On your phone, open the browser and go to:
   ```
   http://192.168.1.42:3456/app
   ```
   *(replace with your actual PC IP)*

4. Add to Home Screen:
   - **iPhone (Safari):** tap Share → Add to Home Screen
   - **Android (Chrome):** tap ⋮ menu → Add to Home Screen

You now have a home screen icon. Tap it → see your memories → tap **Copy context** → paste into ChatGPT/Claude/Gemini app.

---

## 2. iOS Shortcut (one tap from anywhere)

Creates a shortcut that fetches your OMP memories and copies them to clipboard.

**Steps to create:**

1. Open the **Shortcuts** app on your iPhone
2. Tap **+** to create a new shortcut
3. Add these actions in order:

**Action 1: URL**
```
http://YOUR_PC_IP:3456/v1/memories?limit=20
```

**Action 2: Get Contents of URL**
- Method: GET
- Headers: (add if you have an API key)
  - Key: `Authorization`
  - Value: `Bearer YOUR_API_KEY`

**Action 3: Get Dictionary from Input**
- (drag "Contents of URL" as input)

**Action 4: Get Value for Key**
- Key: `memories`

**Action 5: Repeat with Each**
- Add inside: **Get Value for Key** → `content`
- Add inside: **Get Value for Key** → `type`
- Combine as text: `- [type] content`

**Action 6: Copy to Clipboard**

**Action 7: Show Notification**
- Text: `OMP context copied (X memories)`

Name the shortcut **"OMP Context"** and add it to your home screen or Action Button.

**One-tap use:**
- Tap shortcut → memories copied to clipboard
- Open ChatGPT / Claude / Gemini app
- Paste at the start of your message

---

## 3. Remote hosting (access from anywhere, not just home WiFi)

If you want OMP to work when you're not at home, host the server remotely.

### Railway (easiest, free tier available)

1. Fork the repo: `github.com/SMJAI/open-memory-protocol`
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Select your fork → select `packages/server` as the root directory
4. Set environment variables:
   ```
   OMP_API_KEY=your-secret-key
   OMP_DB_PATH=/data/omp.db
   ```
5. Add a Volume: mount path `/data` (keeps your database across restarts)
6. Railway gives you a public URL like `https://omp-production.up.railway.app`

Now set this URL on all your devices:
- **Browser extension:** OMP Bridge popup → Server URL → paste Railway URL
- **Claude Desktop MCP:** set `OMP_SERVER=https://your-url.railway.app` in config
- **omp CLI:** `export OMP_SERVER=https://your-url.railway.app`
- **Mobile PWA:** go to `https://your-url.railway.app/app` (works from any network)

### fly.io

```bash
cd packages/server
fly launch --name omp-server
fly volumes create omp_data --size 1
fly deploy
fly secrets set OMP_API_KEY=your-secret-key
```

### Docker (any VPS)

```bash
docker run -d \
  -p 3456:3456 \
  -v omp-data:/data \
  -e OMP_API_KEY=your-secret-key \
  ghcr.io/smjai/omp-server
```

---

## Mobile flow (full picture)

```
Phone (ChatGPT app)
  → tap OMP shortcut or open PWA
  → copy context / get handoff brief
  → paste into ChatGPT
  → ChatGPT knows your context

Later, on desktop
  → OMP Bridge extension auto-shows handoff toast
  → Continue in Claude Code / Claude Desktop
```

The same OMP server connects everything — phone, desktop, any AI tool.
