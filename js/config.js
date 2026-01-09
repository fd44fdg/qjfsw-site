const CONFIG = {
    API_KEY: '', // Handled by Cloudflare Worker
    // TODO: Replace with your actual Cloudflare Worker URL after deployment
    // Format: https://nighttrain-api.<your-subdomain>.workers.dev/api/chat
    API_URL: 'https://nighttrain-api.fd44fdg.workers.dev/api/chat',
    MODEL: 'meta/llama-3.1-70b-instruct'
};
// Note: Requests are routed through Cloudflare Worker to bypass CORS and protect API key.
