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
- check a default group list stored in MongoDB
- optionally inspect a custom group by link or ID
- view joined and not-joined group status
- calculate join duration and payout-eligibility warnings
- manage default configuration through an admin panel

## Key Features

- user lookup by username or ID
- custom group checks by link or ID
- user profile and avatar display
- grouping into Joined / Not Joined sections
- built-in search across results
- account and group retrieval through the Roblox API
- admin control over the `group_config` MongoDB document

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

- `MONGODB_URI`: connection string for MongoDB storage of group configuration
- `ROBLOX_API_KEY`: key used for additional Roblox API requests
- `ADMIN_PASS`: password used to manage group settings from the admin panel

## Notes

- The `group_config` document stores the default group list
- If no configuration exists, the application creates an initial default set
- Some information, such as join dates or payout eligibility, may be limited based on Roblox API access rights
- If `ROBLOX_API_KEY` is not configured, the app can still run, but some data may be incomplete

## Goal

Ro-Check is designed to quickly assess Roblox membership status and payout eligibility for a selected account or group set.

---

<p align="center">
  <strong>Ro-Check</strong><br>
  Smart Roblox group membership analysis.
</p>
