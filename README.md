# Arc Raiders Event Timer

Event timer app for Even Realities G2 smart glasses. Displays current and upcoming Arc Raiders game events.

## Features

- **Main Menu**: View current events + navigate to favorites, all upcoming, or settings
- **Favorite Events**: Shows events matching your favorited event types
- **All Upcoming Events**: Shows all future events (paginated)
- **Settings**: Configure auto-launch screen and favorite event types

## Controls

| Screen | Action | Control |
|--------|--------|---------|
| Main Menu | Select menu item | Scroll + tap |
| Main Menu | Refresh events | 2x tap |
| Favorites / All Upcoming | Change page | Scroll up/down |
| Favorites / All Upcoming | Return to menu | 1x tap |
| Edit Favorite Event Types | Move selection | Scroll up/down |
| Edit Favorite Event Types | Toggle checkbox | 1x tap |
| Edit Favorite Event Types | Save & return | 2x tap |

## Setup

```bash
npm install
npm run dev
```

### Run with even-dev simulator

```bash
cd /path/to/even-dev
APP_PATH=/path/to/arc-event-timer ./start-even.sh
```

### Run backend server

```bash
cd server
npm install
npm start
```

## Tech Stack

- **Frontend**: TypeScript + Vite + Even Hub SDK
- **Backend**: Node.js + Hono
- **Data**: MetaForge API

## Deployment

Deploy to Vercel:
1. Push to GitHub
2. Import repo on Vercel
3. Auto-deploys on push
