# Deploying Hygd to Railway

One-time setup to get a public `https://*.up.railway.app` URL that your team
can open from anywhere. Free tier is plenty for one IT team.

## 1 — Make a Railway account (free)

- Go to <https://railway.com> → **Login** → sign in with GitHub.
- Confirm your email when Railway prompts; you'll need it to attach a repo.

## 2 — Create a new project from this repo

- Click **New Project** → **Deploy from GitHub repo**.
- Authorize Railway on the `inquireraincityav/Momentus` repository (or
  whichever fork you'll deploy).
- Pick the branch you're using (e.g. `claude/sweet-brahmagupta-cc32y7` or
  `main` once merged). Railway reads `Procfile`, `railway.json` and
  `runtime.txt` from this repo and configures the build for you.

## 3 — Add a persistent volume for the SQLite database

Without a volume, Railway redeploys wipe the DB.

- In the Railway project → **your service** → **Volumes** → **New Volume**.
- **Mount path:** `/data`
- **Size:** 1 GB is fine for years of events + uploads.

## 4 — Set the required environment variables

Service → **Variables** → **New Variable** for each:

| Name            | Value                                 | Why                                     |
| --------------- | ------------------------------------- | --------------------------------------- |
| `APP_PASSWORD`  | *a password your team will share*     | Gates every page behind a login prompt. |
| `SECRET_KEY`    | *a long random string* (see below)    | Signs the session cookie.               |
| `DB_PATH`       | `/data/events.db`                     | Puts the SQLite file on the volume.     |
| `UPLOAD_FOLDER` | `/data/uploads`                       | Puts uploaded PDFs on the volume.       |
| `VENUE_TZ`      | `America/Vancouver`                   | Already the default, pin it.            |
| `FORCE_HTTPS`   | `true`                                | Marks the session cookie Secure.        |

To generate a `SECRET_KEY` locally:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Paste the output as the value. Treat it like a password — don't commit it.

## 5 — Deploy

Railway auto-deploys on the next push to the branch. You can also click
**Deploy** manually in the UI. Watch the build log — first build takes a
couple of minutes to install dependencies.

Once the deploy finishes, Railway gives you a public URL under
**Settings → Networking → Generate Domain**. Open it, you'll hit the login
page, type the password, and you're in.

## 6 — Give your team the URL + password

They open the URL on their iPads / laptops and sign in with the shared
password. Add the URL to Safari's home screen on each iPad for one-tap
access.

## Running locally without the password gate

If `APP_PASSWORD` is **not set**, the login flow is skipped entirely — your
usual `python app.py` at home keeps working with no changes. The gate only
activates when `APP_PASSWORD` is present.

## Rotating the password

Change `APP_PASSWORD` in Railway → Variables → save. Next deploy restarts
the app with the new password. Everyone currently signed in stays signed in
(their cookies are still valid) — if you want to force a re-login too, also
rotate `SECRET_KEY`.
