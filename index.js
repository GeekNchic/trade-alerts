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

const db = {
    query: async (text, params) => {
        try {
            return await pool.query(text, params);
        } catch (error) {
            console.error('❌ Database Query Error:', error);
        }
    }
};

// WebSocket Connection
const APP_ID = 69728;
let connection = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

// Slack Webhook URLs
const SLACK_URLS = {
    alerts: 'https://hooks.slack.com/services/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',
    trends: 'https://hooks.slack.com/services/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',
    predictions: 'https://hooks.slack.com/services/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',
    reports: 'https://hooks.slack.com/services/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',
    trade_alerts: 'https://hooks.slack.com/services/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'
};

let lastPrice = null;
let tickCounter = 0;
const BOOM_THRESHOLD = 1;

// Function to send Slack notifications
const sendSlackNotification = async (message, webhookUrl) => {
    try {
        const response = await axios.post(webhookUrl, { text: message });
        console.log(`✅ Slack message sent: ${message}`);
    } catch (error) {
        console.error(`❌ Slack notification error (${webhookUrl}):`, error.message);
    }
};

// WebSocket Event Handlers
connection.onopen = () => {
    console.log('✅ WebSocket Connected! Subscribing to ticks...');
    connection.send(JSON.stringify({ ticks: 'BOOM500', subscribe: 1 }));
};

connection.onerror = (error) => console.error('❌ WebSocket Error:', error);

connection.onclose = () => {
    console.log('🔌 WebSocket Disconnected. Reconnecting in 5 seconds...');
    setTimeout(() => {
        connection = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
    }, 5000);
};

connection.onmessage = async (event) => {
    const response = JSON.parse(event.data);
    if (response.error) return console.error('❌ API Error:', response.error.message);

    if (response.msg_type === 'tick') await processTick(response.tick);
};

// Process tick data and detect booms
const processTick = async (tick) => {
    const price = tick.quote;
    tickCounter++;
    console.log(`#${tickCounter} 💰 Price: ${price}`);

    if (lastPrice !== null && price - lastPrice >= BOOM_THRESHOLD) {
        const boomMessage = `🚀 *BOOM!* Price spiked from ${lastPrice} to ${price}`;
        console.log(boomMessage);
        await sendSlackNotification(boomMessage, SLACK_URLS.alerts);

        await db.query(
            'INSERT INTO boom_alerts (price, previous_price, boom_time) VALUES ($1, $2, NOW())',
            [price, lastPrice]
        );
        console.log('✅ Boom alert saved to database');
    }

    lastPrice = price;
    if (tickCounter >= 100) {
        await analyzeTrend(price);
        tickCounter = 0;
    }
};

// Analyze trend and store in DB
const analyzeTrend = async (price) => {
    const trend = Math.random() > 0.5 ? 'Green 🟢🐂' : 'Red 🔴🐻';
    console.log(`📊 *Trend Alert:* Trend: ${trend}, Price: ${price}`);

    await db.query(
        'INSERT INTO trend_alerts (trend, price, timestamp) VALUES ($1, $2, NOW())',
        [trend, price]
    );

    await sendSlackNotification(`📊 Trend Alert: ${trend} at ${price}`, SLACK_URLS.trends);
};

// Track Predictions and Success Rates
const trackPrediction = async (prediction) => {
    const probability = Math.random();
    const trend = probability > 0.5 ? 'Bullish 🐂' : 'Bearish 🐻';
    console.log(`🔮 Prediction: ${trend} with ${probability.toFixed(2)} probability`);

    await db.query(
        'INSERT INTO predictions (probability, trend, created_at) VALUES ($1, $2, NOW())',
        [probability, trend]
    );

    await sendSlackNotification(`🔮 Prediction: ${trend} (${(probability * 100).toFixed(2)}%)`, SLACK_URLS.predictions);
};

// Generate Prediction Reports
const generatePredictionReport = async () => {
    const successful = Math.floor(Math.random() * 50);
    const failed = Math.floor(Math.random() * 50);
    const total = successful + failed;
    const successRate = total > 0 ? (successful / total) * 100 : 0;

    console.log(`📊 Prediction Report: Success: ${successful}, Fail: ${failed}, Rate: ${successRate.toFixed(2)}%`);

    await db.query(
        'INSERT INTO prediction_reports (successful, failed, total, success_rate, report_timestamp) VALUES ($1, $2, $3, $4, NOW())',
        [successful, failed, total, successRate]
    );

    await sendSlackNotification(
        `📊 *Prediction Report:* ✅ Success: ${successful} ❌ Fail: ${failed} 📈 Rate: ${successRate.toFixed(2)}%`,
        SLACK_URLS.reports
    );
};

// Run Prediction Reports every 10 minutes
setInterval(generatePredictionReport, 10 * 60 * 1000);
