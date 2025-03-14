const { Pool } = require('pg');
const WebSocket = require('ws');
const axios = require('axios');
const pgp = require('pg-promise')();

// PostgreSQL Database Connection
const pool = new Pool({
    user: 'postgres', 
    host: '34.42.242.121',   
    database: 'trade_alerts_db',  
    password: 'R|I&L>OyAMkI^HH@', 
    port: 5432,
    ssl: {
      rejectUnauthorized: false
    }
});

const db = {
    query: (text, params) => pool.query(text, params),
};

const APP_ID = 69728;
let connection = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

const SLACK_ALERTS_URL = 'https://hooks.slack.com/services/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';
const SLACK_TRENDS_URL = 'https://hooks.slack.com/services/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';
const SLACK_PREDICTIONS_URL = 'https://hooks.slack.com/services/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';
const SLACK_REPORTS_URL = 'https://hooks.slack.com/services/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';
const SLACK_TRADE_ALERT_URL = 'https://hooks.slack.com/services/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';

let lastPrice = null;
let lastBoomTime = null;
let tickCounter = 0;
let trendCounter = 0;
const BOOM_THRESHOLD = 1;
let successCount = 0;
let failureCount = 0;

// Function to send Slack notifications
const sendSlackNotification = async (message, webhookUrl) => {
    try {
        await axios.post(webhookUrl, { text: message });
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
    const timestamp = new Date();
    tickCounter++;

    console.log(`#${tickCounter} 💰 Price: ${price}`);

    if (lastPrice !== null && price - lastPrice >= BOOM_THRESHOLD) {
        const boomMessage = `🚀 *BOOM!* Price spiked from ${lastPrice} to ${price}`;
        console.log(boomMessage);
        await sendSlackNotification(boomMessage, SLACK_ALERTS_URL);
        lastBoomTime = timestamp;

        try {
            await db.query('INSERT INTO boom_alerts (price, previous_price, boom_time) VALUES ($1, $2, $3)', 
                [price, lastPrice, timestamp]);
            console.log('✅ Boom alert saved to database');
        } catch (error) {
            console.error('❌ Database insertion error:', error);
        }
    }

    lastPrice = price;

    if (tickCounter >= 100) {
        await analyzeTrend(price, timestamp);
        tickCounter = 0;
    }
};

// Analyze trend and send update
const analyzeTrend = async (currentPrice, currentTimestamp) => {
    const trend = Math.random() > 0.5 ? 'Green 🟢🐂' : 'Red 🔴🐻';
    trendCounter++;

    try {
        await db.query(
            "INSERT INTO trend_alerts (trend, price, timestamp) VALUES ($1, $2, $3)",
            [trend, currentPrice, currentTimestamp]
        );
    } catch (error) {
        console.error('❌ Database insertion error:', error);
    }

    const trendMessage = `📊 *Trend Alert (#${trendCounter})*:\n🔹 Trend: ${trend}\n💰 Current Price: ${currentPrice}`;
    console.log(trendMessage);
    await sendSlackNotification(trendMessage, SLACK_TRENDS_URL);
};

// Open WebSocket connection
connection.onopen = () => {
    console.log('✅ WebSocket Connected! Subscribing to ticks...');
    connection.send(JSON.stringify({ ticks: 'BOOM500', subscribe: 1 }));
};

connection.onerror = (error) => {
    console.error('❌ WebSocket Error:', error);
};

connection.onclose = () => {
    console.log('🔌 WebSocket Disconnected. Reconnecting in 5 seconds...');
    setTimeout(() => connection = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`), 5000);
};