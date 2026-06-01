# AttendEase — Company Attendance App
### Free hosting + Free database | 12 employees | 4 leave rule | 120 min permission rule

---

## ✅ Features
- Mark attendance: Present / Absent / Late / Permission
- Auto-flag: Permission > 120 min → marked as Late
- Leave tracker: 4 leaves max per month (Absent + Late count)
- Permission tracker per employee per month
- Calendar view per employee
- Monthly report (CSV download)
- Auto-delete month data after report download
- Add / Edit / Delete employees

---

## 🚀 Setup in 4 Steps (All FREE)

---

### STEP 1 — Create Free Firebase Database

1. Go to **https://console.firebase.google.com**
2. Click **"Add project"** → Name it `attendease` → Create
3. In left sidebar → **Firestore Database** → **Create database**
   - Choose **"Start in test mode"** → Next → Select nearest region → Done
4. In left sidebar → **Project Settings** (gear icon)
5. Scroll down → **"Your apps"** → Click **"</>"** (Web) icon
6. Register app name → Copy the `firebaseConfig` object

---

### STEP 2 — Set Up Your Config

1. Copy `.env.example` to `.env.local`
2. Fill in your Firebase values:

```
NEXT_PUBLIC_FIREBASE_API_KEY=AIza...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123:web:abc123
```

---

### STEP 3 — Run Locally (Optional Test)

```bash
npm install
npm run dev
```
Open http://localhost:3000

---

### STEP 4 — Deploy FREE on Vercel

1. Push this folder to **GitHub** (create new repo)
2. Go to **https://vercel.com** → Sign up free with GitHub
3. Click **"New Project"** → Import your GitHub repo
4. In **Environment Variables**, add all 6 NEXT_PUBLIC_FIREBASE_* values
5. Click **Deploy** → Done! 🎉

Your app is live at: `https://your-app-name.vercel.app`

---

## 📋 How to Use Daily

### Mark Attendance
1. Open app → **Today** tab
2. Click **Mark** next to each employee
3. Choose: ✅ Present / ❌ Absent / ⏰ Late / 🕐 Permission
4. For Permission: enter minutes (>120 auto-marks as Late)

### View Calendar
- Go to **Calendar** tab → Select employee → View month

### Monthly Report
- Go to **Report** tab
- Select month → **Download CSV** (keeps data)
- OR → **Download + Delete Month** (saves report, clears database for that month)

---

## 🏢 Company Rules Configured
| Rule | Value |
|------|-------|
| Max leaves per month | 4 days |
| Max permission per day | 120 minutes |
| Over 120 min permission | Auto-marked as Late |
| Late counts as | Leave day |

---

## 📁 Files
```
attendance-app/
├── pages/
│   ├── _app.js          ← App wrapper
│   └── index.js         ← Main app (all tabs)
├── lib/
│   └── firebase.js      ← Database connection
├── styles/
│   └── globals.css      ← All styles
├── .env.example         ← Firebase config template
├── next.config.js
└── package.json
```
"# attendance_app_new" 
