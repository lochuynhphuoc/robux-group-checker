# Ro-Check

<p align="center">
  <img src="https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white" alt="HTML5" />
  <img src="https://img.shields.io/badge/CSS3-1572B6?logo=css3&logoColor=white" alt="CSS3" />
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black" alt="JavaScript" />
  <img src="https://img.shields.io/badge/MongoDB-47A248?logo=mongodb&logoColor=white" alt="MongoDB" />
  <img src="https://img.shields.io/badge/Vercel-000000?logo=vercel&logoColor=white" alt="Vercel" />
</p>

Ro-Check is a web application that inspects the groups a Roblox account has joined and identifies which groups are active memberships, which are not joined, and whether payout eligibility is available.

## Overview

This project helps users:
- enter a Roblox username or user ID
- check all groups the account has joined without requiring a configured group list
- optionally bulk check up to 100 groups by Roblox group link or ID
- load results eight groups at a time with a More button
- view joined and not-joined group status
- calculate join duration and payout-eligibility warnings
- manage default configuration through an admin panel

## Key Features

- user lookup by username or ID
- custom group checks by link or ID
- user profile and avatar display
- grouping into Joined / Not Joined sections
- built-in search across results
- optional web accounts with secure sessions
- saved group lists that can be selected as the default check set
- optional display of other groups outside the selected saved list
- account and group retrieval through the Roblox API
- admin control over the legacy `group_config` MongoDB document

## Technology Stack

| Category | Technology |
| --- | --- |
| Frontend | HTML, CSS, JavaScript |
| Backend | Vercel Serverless Functions |
| Database | MongoDB |
| API Integration | Roblox Public API |
| Hosting | Vercel |

## Project Structure

```bash
robux-group-checker/
├── api/
│   ├── admin.js
│   └── index.js
├── public/
│   ├── admin.html
│   └── index.html
├── vercel.json
├── package.json
├── README.md
├── .env
└── .gitignore
```

## Environment Variables

The application relies on the following environment variables:

```env
MONGODB_URI=mongodb+srv://username:password@host/dbname
ROBLOX_API_KEY=your_roblox_api_key
ADMIN_PASS=your_admin_password
```

### Variable Purpose

- `MONGODB_URI`: connection string used by the admin panel and the shared request rate limiter
- `ROBLOX_API_KEY`: key used for additional Roblox API requests
- `ADMIN_PASS`: password used to manage group settings from the admin panel

Account data is stored in the `rocheck.users` and `rocheck.sessions` MongoDB collections.
Passwords are stored as salted scrypt hashes and sessions use an HttpOnly cookie. Accounts
are optional: guests can continue checking groups without registering, while signed-in
users can save up to 20 named lists of up to 100 group IDs each.

## Notes

- Leaving the group list blank checks every group the Roblox account has joined
- Group links or IDs can be separated by new lines, commas, or semicolons
- The optional group list checks the account's membership in those specific groups, including groups not joined
- Results are loaded in batches of eight; each Roblox API request has an eight-second timeout, and join-date lookups run with limited concurrency
- Each membership-check request has a one-minute overall timeout. Requests are limited to 20 per IP per minute and 120 per IP per hour using a shared MongoDB counter, so separate devices on the same public IP share the limit
- Rate-limit records store an HMAC of the client IP (not the raw IP) and expire automatically after two hours. IP limits identify a network, not an individual, and can be bypassed by changing networks or using a VPN; use authentication or a managed WAF for stronger identity-based protection
- The admin panel's `group_config` no longer limits checks on the main page
- The main page explains the account workflow and lets signed-in users choose a saved list,
  save the current group input, delete lists, and include memberships outside the saved list
- Some information, such as join dates or payout eligibility, may be limited based on Roblox API access rights
- If `ROBLOX_API_KEY` is not configured, the app can still run, but some data may be incomplete

## Goal

Ro-Check is designed to quickly assess Roblox membership status and payout eligibility for a selected account or group set.

---

<p align="center">
  <strong>Ro-Check</strong><br>
  Smart Roblox group membership analysis.
</p>
