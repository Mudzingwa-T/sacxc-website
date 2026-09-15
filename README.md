# SACXC — Southern Africa Customer Experience Council

> Front-end built on **CICM Global's design system** (its actual stylesheet, components, fonts and layout), recoloured to the SACXC logo. Backend, database and CMS are unchanged: Node + Express + **better-sqlite3**.

Public website **and** content-management system for SACXC, built on **Node.js + Express + EJS** with a **better-sqlite3** database (real, on-disk SQLite with WAL journalling — durable across restarts). This is the same engine, CMS and security posture used for production Council/association sites, rebranded to SACXC's navy-and-red identity and seeded from the approved website deck.

## Run locally

Requires **Node.js 18–22**.

```
npm install
npm start
```

Open http://localhost:3000 . The CMS is at http://localhost:3000/sacxc-cms .

The database, settings, pages, hero, services, members and everything else are **seeded automatically on first boot** — there is no manual database step.

## First login (secure)

On first run a **random** super-admin password is generated and written to `data/FIRST_LOGIN.txt` (server-side only — never in source or the console). Sign in, and you are **forced to change it immediately**; the file is then deleted automatically.

- Super-admin email: `tfmudzingwa@tech24group.com`
- Password: see `data/FIRST_LOGIN.txt` after the first `npm start`

Add other staff (editors / admins) with their own passwords from **Users & Roles** in the CMS.

## Admin login

- Username: `admin`
- Password: `Sacxc2026!`

Change this immediately under **Users** in the CMS. A Code Labs Alliance developer account is also provisioned.

## What the CMS manages

**Website Content** — edit the body text across the public pages directly (cxnewsafrica-style). **Navigation Menu** — the site's top menu is CMS-driven: add, rename, reorder, hide or remove items and the header updates instantly. Plus:

Site settings (name, contact, socials, maintenance mode), homepage hero slides, per-page heroes, the six service pillars (Member Benefits), news, events, media gallery, partners/ACXCO, resources, council leadership, the membership/partnership enquiries inbox, contact messages, staff users with roles, a full audit log, and privacy-respecting page analytics. Images (logo, hero photos, leadership) are uploaded directly in the CMS.

## Photography

The hero and page banners ship with polished on-brand backgrounds. To use real photographs, open the CMS → **Hero Slides** (and **Page Heroes**) and upload an image for each — any royalty-free customer-experience / business team photo works well.

## Deploying

Runs on any Node host (Hostinger Node.js hosting via Passenger, Render, Railway, a VPS). For production set `NODE_ENV=production` in `.env` and replace `SESSION_SECRET` with a fresh random value:

```
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Designed & developed by Tech24 Group — https://www.tech24group.com
