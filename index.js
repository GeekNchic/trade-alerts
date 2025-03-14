const { Pool } = require('pg');
const WebSocket = require('ws');
const axios = require('axios');

// PostgreSQL Database Connection
const pool = new Pool({
    user: 'postgres',
    host: '34.42.242.121',
    database: 'trade_alerts_db',
    password: 'R|I&L>OyAMkI^HH@',
    port: 5432,
    ssl: { rejectUnauthorized: false }
});

// Utility for database queries
const db = {
    query: async (text, params) => {
        try {
            return await pool.query(text, params);
        } catch (error) {
            console.error('❌ Database error:', error);
        }
    }
};

// WebSocket connection to Deriv
const APP_ID = 69728;
let connection = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

// Slack Webhook URLs
const SLACK_ALERTS_URL = 'https://hooks.slack.com/services/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';
const SLACK_TRENDS_URL = 'https://hooks.slack.com/services/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';

// Tracking variables
let lastPrice = null;
let priceHistory = [];

// Function to send Slack notifications
const sendSlackNotification = async (message, webhookUrl) => {
    try {
        const response = await axios.post(webhookUrl, { text: message }, {
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.status === 200) {
            console.log('✅ Slack message sent:', message);
        } else {
            console.error('❌ Slack message failed:', response.data);
        }
    } catch (error) {
        console.error('❌ Slack notification error:', error);
    }
};

// Handle WebSocket messages
connection.onmessage = async (event) => {
    const response = JSON.parse(event.data);

    if (response.error) {
        console.error('❌ API Error:', response.error.message);
        return;
    }

    if (response.msg_type === 'tick') {
        await processTick(response.tick);
    }
};

// Process tick data
const processTick = async (tick) => {
    const price = tick.quote;
    console.log(`💰 Price Update: ${price}`);

    if (lastPrice !== null) {
        priceHistory.push(price);

        // Keep only the last 100 prices
        if (priceHistory.length > 100) {
            priceHistory.shift();
        }
    }

    lastPrice = price;

    // Analyze trend after 100 ticks
    if (priceHistory.length === 100) {
        await analyzeTrend();
    }
};

// Analyze trend over last 100 ticks
const analyzeTrend = async () => {
    let upCount = 0;
    let downCount = 0;

    for (let i = 1; i < priceHistory.length; i++) {
        if (priceHistory[i] > priceHistory[i - 1]) {
            upCount++;
        } else if (priceHistory[i] < priceHistory[i - 1]) {
            downCount++;
        }
    }

    let trend = 'Neutral ⚪';
    if (upCount > downCount) {
        trend = 'Bullish 🟢';
    } else if (downCount > upCount) {
        trend = 'Bearish 🔴';
    }

    const trendMessage = `📊 *Trend Analysis (Last 100 Ticks)*\n🔹 Trend: ${trend}\n📈 Up Movements: ${upCount}\n📉 Down Movements: ${downCount}`;
    console.log(trendMessage);

    await sendSlackNotification(trendMessage, SLACK_TRENDS_URL);

    try {
        await db.query("INSERT INTO trend_alerts (trend, up_moves, down_moves, timestamp) VALUES ($1, $2, $3, NOW())", 
            [trend, upCount, downCount]);
        console.log('✅ Trend alert saved to database');
    } catch (error) {
        console.error('❌ Database insertion error:', error);
    }
};

// WebSocket connection handling
connection.onopen = () => {
    console.log('✅ WebSocket Connected! Subscribing to BOOM500...');
    connection.send(JSON.stringify({ ticks: 'BOOM500', subscribe: 1 }));
};

connection.onerror = (error) => {
    console.error('❌ WebSocket Error:', error);
};

connection.onclose = () => {
    console.log('🔌 WebSocket Disconnected. Reconnecting in 5 seconds...');
    setTimeout(() => {
        connection = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
    }, 5000);
};
