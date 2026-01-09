const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });

const app = express();
const PORT = 3001;

// Enable CORS for frontend
app.use(cors());
app.use(express.json());

// Legacy non-streaming endpoint (optional, kept for fallback)
app.post('/api/chat', async (req, res) => {
    try {
        const payload = req.body;
        const response = await axios.post('https://integrate.api.nvidia.com/v1/chat/completions', payload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': process.env.API_KEY
            }
        });
        res.json(response.data);
    } catch (error) {
        handleError(res, error);
    }
});

// Streaming endpoint
app.post('/api/chat/stream', async (req, res) => {
    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        const payload = { ...req.body, stream: true }; // Force stream=true

        console.log("Starting stream request...");

        const response = await axios.post('https://integrate.api.nvidia.com/v1/chat/completions', payload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': process.env.API_KEY
            },
            responseType: 'stream'
        });

        // Forward the stream
        response.data.on('data', (chunk) => {
            const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');
            for (const line of lines) {
                // Determine if it's data or error
                if (line.startsWith('data: ')) {
                    const dataStr = line.replace('data: ', '');
                    if (dataStr === '[DONE]') {
                        res.write('data: [DONE]\n\n');
                        continue;
                    }
                    try {
                        const json = JSON.parse(dataStr);
                        // Forward valid chunks
                        res.write(`data: ${JSON.stringify(json)}\n\n`);
                    } catch (e) {
                        console.warn("Failed to parse chunk:", dataStr);
                    }
                }
            }
        });

        response.data.on('end', () => {
            res.end();
            console.log("Stream ended.");
        });

        response.data.on('error', (err) => {
            console.error("Stream error:", err);
            res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
            res.end();
        });

    } catch (error) {
        console.error("Setup stream error:", error.message);
        res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
    }
});

function handleError(res, error) {
    if (error.response) {
        console.error("API Response Error:", error.response.status, error.response.data);
        res.status(error.response.status).json(error.response.data);
    } else {
        console.error("Proxy Error:", error.message);
        res.status(500).json({ error: error.message });
    }
}

app.listen(PORT, () => {
    console.log(`Proxy server running on http://localhost:${PORT}`);
});
