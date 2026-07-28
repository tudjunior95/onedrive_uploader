# Setup Guide: Custom OneDrive Photo Uploader

This gives you a clean upload page (no login required for uploaders) that pushes
files straight into a folder in your personal OneDrive, with no per-batch file limit.

There are three parts:
1. Register an app with Microsoft so it's allowed to write to your OneDrive
2. Deploy the server (this repo) to Render, a free hosting service
3. Do a one-time "connect" step so the server can act on your behalf

---

## Part 1: Register the app with Microsoft (~10 minutes)

> **If your OneDrive is a personal (consumer) Microsoft account**, follow the
> steps below as written, and use `TENANT=consumers` in Part 2.
>
> **If your OneDrive is on a Single Tenant Microsoft 365 subscription**
> (i.e. a work/school-style tenant, even if it's your own personal
> subscription), two things differ:
> - In step 3 below, choose **"Accounts in this organizational directory
>   only (Single tenant)"** instead of "Personal Microsoft accounts only"
> - In Part 2, set `TENANT` to your actual **Tenant ID** (a GUID shown on
>   the Entra ID → Overview page) instead of `consumers`
> - After step 7 below, you may see a **"Grant admin consent for
>   [your org]"** button on the API permissions page — click it. If you're
>   the sole/admin user on the subscription this should just work; if you
>   don't see that option or it's greyed out, the tenant has stricter
>   policies and someone with admin rights needs to approve the permission.

1. Go to https://portal.azure.com and sign in with the **same Microsoft account
   your OneDrive uses**.
2. Search for **"App registrations"** in the top search bar and open it.
3. Click **New registration**.
   - **Name**: anything, e.g. `Photo Uploader`
   - **Supported account types**: choose **"Personal Microsoft accounts only"**
     (or the single-tenant option — see note above)
   - **Redirect URI**: leave blank for now (you'll add it after Part 2, once you
     have your Render URL)
4. Click **Register**.
5. On the app's Overview page, copy the **Application (client) ID** — you'll need
   this as `CLIENT_ID`. If you're on a single tenant, also copy the
   **Directory (tenant) ID** shown just below it — you'll need this as `TENANT`.
6. In the left sidebar, click **Certificates & secrets** → **New client secret**.
   - Give it any description, choose an expiry (24 months is fine)
   - Click **Add**, then immediately copy the **Value** (not the Secret ID) —
     this is your `CLIENT_SECRET`. It's only shown once.
7. In the left sidebar, click **API permissions** → **Add a permission** →
   **Microsoft Graph** → **Delegated permissions**.
   - Search for and check **Files.ReadWrite**
   - Also check **offline_access** if it's not already there
   - Click **Add permissions**
   - If a **"Grant admin consent"** button appears, click it (see note above)

Keep this browser tab open — you'll come back to add the Redirect URI in Part 3.

---

## Part 2: Deploy to Render (free hosting)

1. Create a free account at https://render.com (you can sign up with GitHub).
2. Put this project's code in a GitHub repository:
   - Create a new repo (e.g. `onedrive-uploader`) at https://github.com/new
   - Upload all the files from this project into it (drag-and-drop works on
     GitHub's web UI for a first commit, or use `git push` if you're comfortable
     with git)
3. In Render, click **New** → **Web Service**, connect your GitHub account, and
   select the repo you just created.
4. Configure the service:
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance type**: Free
5. Under **Environment Variables**, add:
   - `CLIENT_ID` = (from Part 1)
   - `CLIENT_SECRET` = (from Part 1)
   - `TENANT` = `consumers` for a personal Microsoft account, **or your Tenant
     ID (GUID) if you're on a Single Tenant subscription** — see the note in
     Part 1
   - `REDIRECT_URI` = `https://YOUR-SERVICE-NAME.onrender.com/auth/callback`
     (you'll know the exact URL once Render assigns it — it's shown at the top
     of your service page, usually `https://<service-name>.onrender.com`)
   - `TARGET_FOLDER` = the OneDrive folder name you want uploads to land in,
     e.g. `Photo Uploads` (it'll be created automatically if it doesn't exist)
6. Click **Create Web Service**. Render will build and deploy it — this takes a
   couple of minutes.

**Note on the free tier:** Render's free web services spin down after 15 minutes
of no traffic and take ~30-60 seconds to wake back up on the next request. Fine
for casual/occasional use; just give it a moment to spin up if you visit after
it's been idle.

---

## Part 3: Connect the app to your OneDrive (one-time)

1. Back in the Azure portal (Part 1), go to your app → **Authentication** →
   **Add a platform** → **Web**.
   - Redirect URI: `https://YOUR-SERVICE-NAME.onrender.com/auth/callback`
     (must exactly match what you set as `REDIRECT_URI` in Render)
   - Save
2. Visit `https://YOUR-SERVICE-NAME.onrender.com/auth/login` in your browser.
3. Sign in with your Microsoft account and approve the permissions.
4. You should see "OneDrive connected." — that's it.

From now on, anyone who visits `https://YOUR-SERVICE-NAME.onrender.com/` sees
the upload page and can drop in as many photos as they want. No account needed
on their end. Files land in the `Photo Uploads` folder (or whatever you named
it) in your OneDrive.

---

## Notes

- If you ever redeploy or the service restarts and loses its stored connection,
  just visit `/auth/login` again to reconnect — takes a few seconds.
- File size limit is currently set to 200MB per file in `server.js` (see
  `limits: { fileSize: ... }`) — easy to raise if needed.
- Filenames that collide with existing files in the folder get automatically
  renamed by OneDrive rather than overwritten.
