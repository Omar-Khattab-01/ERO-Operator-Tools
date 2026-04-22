# ERO Operator Tools

A tool for operators, made by an operator.

ERO Operator Tools is a lightweight web app for OC Transpo Electric Rail Operators. It focuses on fast paddle lookup, live duty awareness, and a first-stage Line 1 operations mimic built around the way operators actually read their work.

## Features

- **ERO paddle lookup**: Search by full paddle ID like `1-14`, or shorthand like `14`.
- **Multiple paddle comparison**: Look up more than one paddle and keep results visible together.
- **Live status cards**: See whether a paddle is on a trip, on a break, on split, upcoming, or done.
- **Trip countdowns**: Shows remaining time for active trips and break countdowns.
- **Split-piece awareness**: Displays first-piece and second-piece start/clear times, split duration, and back-on-clock time.
- **Today Board**: Dispatch-style view for active paddles, upcoming work, split breaks, and finishing-soon work.
- **CLC warning support**: Flags upcoming 30+ minute breaks when a paddle is approaching a longer break.
- **Line 1 scheduled mimic**: Full-width ATS-style mimic with Track 1 westbound, Track 2 eastbound, stations, blocks, occupancy, zoom controls, and block-to-paddle links.
- **Paddle source files**: Keeps the Spring ERO paddle PDFs and parsed paddle index in the project.

## Current Scope

This version intentionally keeps the live mimic simple:

- Main Line 1 running tracks only.
- No switches.
- No crossovers.
- No interlockings.
- No yard geometry.
- Train/block positions are scheduled from ERO paddle work, not live GTFS.

The goal is to establish a clean, operator-style foundation first, then add more operational detail later.

## Accounts

Account and saved-work support is planned next using Supabase, similar to the Bus Operator Tools project.

For now, the app runs without Supabase configuration.

## Tech Stack

- Node.js
- Express
- Vanilla HTML/CSS/JavaScript
- Vercel-compatible serverless deployment

## Local Development

Install dependencies:

```bash
npm install
```

Start the app:

```bash
npm start
```

Open:

```text
http://localhost:7860
```

## Project Structure

```text
server.js                  Express server and API routes
public/index.html          Main app UI
Paddles/Spring/*.pdf       Source ERO paddle PDFs
data/paddles.index.json    Parsed paddle index used by the app
tools/build_paddle_index.py Paddle parser/index builder
supabase/schema.sql        Planned account/saved-work database schema
vercel.json                Vercel deployment config
```

## API Routes

- `GET /healthz`
- `GET /api/paddle?id=1-14`
- `POST /api/chat`
- `GET /api/today-board`
- `GET /api/live-map`
- `GET /api/account-options`
- `GET /api/supabase-config`

## Deployment Notes

The app is prepared for Vercel using `vercel.json` and exports the Express app for serverless execution.

Future account setup will require Supabase environment variables once saved work is enabled.
