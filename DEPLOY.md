# Ayush Pharmacy – deployment

| | |
|---|---|
| URL | https://ayushpharma.thangaminfotech.com |
| Server | 156.67.104.242, folder `/opt/projects/ayushpharma` |
| Containers | `ayushpharma-frontend` (127.0.0.1:3120) / `ayushpharma-backend` (127.0.0.1:5120), compose project `ayushpharma` |
| nginx | `/etc/nginx/sites-available/ayushpharma.conf` (from `deploy/nginx-site.conf`) |
| Database | `T_Pharmacy` on 147.93.155.21 (set in `backend/.env`) |
| Document numbers | `AP-PO0001`, `AP-SI0001`, `AP-S0001` … (`CLINIC_CODE=AP`) |
| First login | `Admin` / `Admin@1` – change it in Settings → User Master |

Registered in `../../PORT_REGISTRY.md`.

## Deploy / redeploy

From this folder (the script backs up the old server folder first, rebuilds
only this app's containers, adds only its own nginx site, runs `nginx -t`
before reloading):

```
set DEPLOY_PASSWORD=<root password>
python deploy/deploy.py
```

Add `--init-db` to also run the schema script (`backend/src/db/initDb.js`).
It only creates missing tables and pick-list values, so it is safe to re-run.

## Local development

```
cd backend && npm install && npm run dev       # API on :5000
cd frontend && npm install && npm run dev      # web on :5173, proxies /api
```
