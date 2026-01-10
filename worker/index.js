// Cloudflare Worker for Night Train API Proxy
// This handles dual-provider fallback: DeepSeek (Primary) -> NVIDIA (Secondary)

export default {
    async fetch(request, env) {
        // Handle CORS preflight
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        if (request.method !== 'POST') {
            return new Response('Method not allowed', { status: 405 });
        }

        const url = new URL(request.url);
        const isStreaming = url.pathname === '/api/chat/stream';

        try {
            const body = await request.json();
            if (isStreaming) body.stream = true;

            // Strategy: Try DeepSeek First
            try {
                // DeepSeek can be sensitive to unsupported parameters, cleaning up
                const dsBody = {
                    model: "deepseek-chat",
                    messages: body.messages,
                    stream: body.stream,
                    temperature: body.temperature || 0.7,
                    max_tokens: body.max_tokens || 1024
                };

                const dsResponse = await fetch('https://api.deepseek.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`
                    },
                    body: JSON.stringify(dsBody)
                });

                if (dsResponse.ok) {
                    return this.handleResponse(dsResponse, isStreaming, corsHeaders);
                }

                console.error(`DeepSeek Error: ${dsResponse.status}`);
            } catch (err) {
                console.error("DeepSeek Connection Failed:", err);
            }

            // Fallback: Try NVIDIA
            console.log("Falling back to NVIDIA API...");
            const nvResponse = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': env.API_KEY // Existing env variable
                },
                body: JSON.stringify(body)
            });

            return this.handleResponse(nvResponse, isStreaming, corsHeaders);

        } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }
    },

    async handleResponse(response, isStreaming, corsHeaders) {
        if (isStreaming) {
            return new Response(response.body, {
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'text/event-stream; charset=utf-8',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                }
            });
        }

        const data = await response.json();
        return new Response(JSON.stringify(data), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
};
