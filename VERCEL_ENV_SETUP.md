# Vercel Environment Variables Setup

This guide explains how to set up all required environment variables for the SMS Subscription Site deployment on Vercel.

## ⚠️ Important: This is the Subscription Site Only

**The subscription site does NOT send SMS** - it only manages credits and subscriptions. The main app sends SMS.

**Flow:**
1. User transfers tickets via SMS from main app (`index.html`)
2. Main app checks credits via subscription site API (`/api/check-sms-credits`)
3. Main app sends SMS using its own `send-sms.js` endpoint
4. Subscription site only manages: credits, payments, user registration

## Required Environment Variables

### 1. Firebase Admin SDK (REQUIRED)

These are **essential** for the site to work. Without these, Firebase operations will fail.

#### How to Get Firebase Credentials:

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project
3. Go to **Project Settings** (gear icon) → **Service Accounts**
4. Click **Generate New Private Key**
5. Download the JSON file
6. Extract the following values from the JSON:

```json
{
  "project_id": "your-project-id",
  "client_email": "firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
}
```

#### Variables to Set in Vercel:

| Variable Name | Value | Example |
|--------------|-------|---------|
| `FIREBASE_PROJECT_ID` | From `project_id` in JSON | `my-app-12345` |
| `FIREBASE_CLIENT_EMAIL` | From `client_email` in JSON | `firebase-adminsdk-xxxxx@my-app-12345.iam.gserviceaccount.com` |
| `FIREBASE_PRIVATE_KEY` | From `private_key` in JSON (keep the `\n` characters) | `-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n` |

**⚠️ Important for FIREBASE_PRIVATE_KEY:**
- Copy the ENTIRE private key including `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----`
- Keep the `\n` characters (newlines) - Vercel will handle them
- The code automatically converts `\\n` to actual newlines

---

### 2. SMS Service Credentials (NOT NEEDED FOR SUBSCRIPTION SITE)

**⚠️ The subscription site does NOT send SMS**, so you do NOT need Twilio or Textbelt credentials here.

**SMS credentials should be set in the MAIN APP deployment**, not here.

If you see `send-sms.js` in this folder, it's a leftover/duplicate and not used in production.

---

### 4. Telegram Notifications (OPTIONAL - for admin notifications)

Only needed if you want Telegram notifications for payment requests.

#### How to Get Telegram Credentials:

1. Create a bot via [@BotFather](https://t.me/botfather) on Telegram
2. Get your bot token
3. Get your chat ID (send a message to your bot, then visit `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`)

#### Variables to Set in Vercel:

| Variable Name | Value | Example |
|--------------|-------|---------|
| `TELEGRAM_BOT_TOKEN` | Your Telegram bot token | `123456789:ABCdefGHIjklMNOpqrsTUVwxyz` |
| `TELEGRAM_ADMIN_CHAT_ID` | Your Telegram chat ID | `123456789` |

---

## How to Set Environment Variables in Vercel

### Method 1: Via Vercel Dashboard (Recommended)

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project (`smssub-website` or your project name)
3. Go to **Settings** → **Environment Variables**
4. Click **Add New**
5. Enter the **Name** and **Value** for each variable
6. Select **Environment(s)**: Choose **Production**, **Preview**, and/or **Development**
7. Click **Save**
8. **Redeploy** your project for changes to take effect

### Method 2: Via Vercel CLI

```bash
# Set a single variable
vercel env add FIREBASE_PROJECT_ID

# Set multiple variables (interactive)
vercel env add

# Pull environment variables to local .env
vercel env pull .env
```

---

## Environment Variable Checklist

### ✅ Required (Site won't work without these):
- [ ] `FIREBASE_PROJECT_ID`
- [ ] `FIREBASE_CLIENT_EMAIL`
- [ ] `FIREBASE_PRIVATE_KEY`

### ⚠️ Optional (Site works but features may be limited):
- [ ] `TELEGRAM_BOT_TOKEN` (admin notifications)
- [ ] `TELEGRAM_ADMIN_CHAT_ID` (admin notifications)

**Note:** SMS credentials (Twilio/Textbelt) are NOT needed here - they go in the MAIN APP deployment.

---

## Testing Your Environment Variables

After setting the variables and redeploying:

1. **Test Firebase Connection:**
   - Try logging into the admin panel
   - If Firebase is working, login should succeed

2. **Check Vercel Logs:**
   - Go to Vercel Dashboard → Your Project → **Logs**
   - Look for "Firebase Admin Initialized" message
   - If you see Firebase errors, check your credentials

3. **Test API Endpoints:**
   - Visit: `https://your-site.vercel.app/api/check-admin?email=your-admin@email.com`
   - Should return JSON (not HTML error page)

---

## Troubleshooting

### Error: "Firebase Admin Initialization Error"
- ✅ Check that all 3 Firebase variables are set correctly
- ✅ Verify `FIREBASE_PRIVATE_KEY` includes the full key with BEGIN/END markers
- ✅ Ensure no extra spaces or quotes around the values

### Error: "404 Not Found" on API endpoints
- ✅ Check that `vercel.json` is correctly configured
- ✅ Verify the API file exists in `api/` folder
- ✅ Redeploy after setting environment variables

### Error: "Missing environment variable"
- ✅ Check Vercel Dashboard → Settings → Environment Variables
- ✅ Ensure variables are set for the correct environment (Production/Preview)
- ✅ Redeploy after adding variables

---

## Security Best Practices

1. **Never commit `.env` files** to Git (already in `.gitignore`)
2. **Use different Firebase projects** for development and production
3. **Rotate credentials** if they're ever exposed
4. **Limit Firebase service account permissions** to only what's needed
5. **Use Vercel's environment variable encryption** (automatic)

---

## Quick Setup Summary

**Minimum setup (required for Subscription Site):**
```bash
# In Vercel Dashboard → Settings → Environment Variables, add:
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

**For Main App deployment, you ALSO need:**
```bash
# SMS Service credentials (for sending SMS):
TWILIO_ACCOUNT_SID=your-twilio-sid
TWILIO_AUTH_TOKEN=your-twilio-token
TWILIO_FROM_NUMBER=+1234567890
TEXTBELT_API_KEY=your-textbelt-key  # Optional fallback
```

Then **Redeploy** your project!

