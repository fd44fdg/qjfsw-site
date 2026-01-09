const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const app = express();
const PORT = 3001;

// Initialization check
if (!process.env.API_KEY) {
    console.error("❌ ERROR: API_KEY is missing in server/.env");
} else {
    const keyHint = process.env.API_KEY.trim().substring(0, 10) + "...";
    console.log("✅ API_KEY loaded successfully (Hint: " + keyHint + ")");
}

app.use(cors());
app.use(express.json());

// Shared Handler for Chat Requests
const handleChatRequest = async (req, res) => {
    try {
        const payload = req.body;
        if (req.path.includes('/stream')) {
            payload.stream = true;
        }

        const apiKey = (process.env.API_KEY || '').trim();
        const cleanKey = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;

        console.log(`\n--- [${new Date().toLocaleTimeString()}] New Request ---`);
        console.log(`Target Model: ${payload.model}`);
        console.log(`Stream Mode: ${!!payload.stream}`);

        // Remove potentially problematic fields if they exist from local testing
        delete payload.max_tokens;

        const config = {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': cleanKey,
                'Accept': payload.stream ? 'text/event-stream' : 'application/json'
            },
            responseType: payload.stream ? 'stream' : 'json',
            timeout: 60000 // Increase to 60s
        };

        const response = await axios.post('https://integrate.api.nvidia.com/v1/chat/completions', payload, config);

        if (payload.stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            response.data.on('data', (chunk) => {
                res.write(chunk);
            });

            response.data.on('end', () => {
                console.log("✅ Stream completed");
                res.end();
            });

            response.data.on('error', (err) => {
                console.error("❌ Stream error:", err.message);
                res.end();
            });
        } else {
            console.log("✅ JSON response received");
            res.json(response.data);
        }
    } catch (error) {
        const status = error.response?.status || 500;
        let errorData = "";

        console.error(`❌ API ERROR ${status}`);

        if (error.response?.data) {
            if (typeof error.response.data.on === 'function') {
                errorData = "Stream response error";
            } else {
                errorData = JSON.stringify(error.response.data);
            }
        } else {
            errorData = error.message;
        }

        console.error("Detail:", errorData);
        res.status(status).json({ error: errorData, status });
    }
};

app.post('/api/chat', handleChatRequest);
app.post('/api/chat/stream', handleChatRequest);

app.listen(PORT, () => {
    console.log(`🚀 Proxy server running on http://localhost:${PORT}`);
});
