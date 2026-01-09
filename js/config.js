const CONFIG = {
    API_KEY: '', // Handled by Cloudflare Worker
    API_URL: 'https://nighttrain-api.desay-baiimi.workers.dev/api/chat',
    MODEL: 'deepseek-ai/deepseek-v3'
};
// Note: Requests are routed through Cloudflare Worker to bypass CORS and protect API key.
