# Night Train - Cloudflare Deployment

## Project Structure

```
├── index.html          # Main game page
├── css/               # Stylesheets
├── js/                # Frontend JavaScript
├── assets/            # Images and audio
├── scenes.json        # Game scene data
└── worker/            # Cloudflare Worker (deploy separately)
```

## Deployment

### Frontend (Cloudflare Pages)
The static files are served via Cloudflare Pages connected to this repository.

### Backend API (Cloudflare Worker)
The `worker/` directory contains the API proxy that forwards requests to NVIDIA's LLM API.

Deploy the worker separately:
```bash
cd worker
npx wrangler deploy
npx wrangler secret put API_KEY
```

## Local Development

1. Start the proxy server: `npm start`
2. Serve static files: `npx serve .`
3. Open http://localhost:3000

## Live Site
https://qjfsw.xyz
