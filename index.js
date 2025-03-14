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
let tickCounter = 0;
const BOOM_THRESHOLD = 5; // Define what qualifies as a Boom

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
connection.onmessage = (event) => {
    const response = JSON.parse(event.data);

    if (response.error) {
        console.error('❌ API Error:', response.error.message);
        return;
    }

    if (response.msg_type === 'tick') {
        processTick(response.tick);
    }
};

// Process tick data
const processTick = (tick) => {
    const price = tick.quote;
    const timestamp = new Date();
    tickCounter++;

    console.log(`#${tickCounter} 💰 Price: ${price}`);

    if (lastPrice !== null && price - lastPrice >= BOOM_THRESHOLD) {
        const boomMessage = `🚀 *BOOM!* Price spiked from ${lastPrice} to ${price}`;
        console.log(boomMessage);
        sendSlackNotification(boomMessage, SLACK_ALERTS_URL);
        lastBoomTime = timestamp;

        // Insert boom alert into the database
        db.none('INSERT INTO boom_alerts (price, previous_price, boom_time) VALUES ($1, $2, $3)', 
            [price, lastPrice, timestamp])
        .then(() => console.log('✅ Boom alert saved to database'))
        .catch(error => console.error('❌ Database insertion error:', error));
    }

    lastPrice = price;

    if (tickCounter >= 100) {
        analyzeTrend(price, timestamp);
        tickCounter = 0;
    }
};
// Analyze trend and send update
const analyzeTrend = async (currentPrice, currentTimestamp) => {
    const trend = Math.random() > 0.5 ? 'Green 🟢🐂' : 'Red 🔴🐻';
    trendCounter++;

    await db.none(
        "INSERT INTO trend_alerts (trend, price, timestamp) VALUES ($1, $2, $3)",
        [trend, currentPrice, currentTimestamp]
    );

    const trendMessage = `📊 *Trend Alert (#${trendCounter})*:\n🔹 Trend: ${trend}\n💰 Current Price: ${currentPrice}`;
    console.log(trendMessage);
    sendSlackNotification(trendMessage, SLACK_TRENDS_URL);
};

// Schedule probability predictions every 5 minutes
setInterval(async () => {
    const trends = await db.any("SELECT trend FROM trend_alerts ORDER BY id DESC LIMIT 5");

    if (trends.length >= 5) {
        makePrediction(trends);
    }
}, 5 * 60 * 1000);

// Make prediction based on all available trend data
const makePrediction = async (trendData) => {
    const downtrends = trendData.filter(t => t.trend.includes('Red')).length;
    const probability = ((downtrends / trendData.length) * 100).toFixed(2);
    const trend = downtrends > 2 ? 'Red 🔴🐻' : 'Green 🟢🐂';

    await db.none(
        "INSERT INTO predictions (probability, trend) VALUES ($1, $2)",
        [probability, trend]
    );

    const predictionMessage = `📉 *Prediction:* ${probability}% chance of downtrend continuing in next 7 minutes`;
    console.log(predictionMessage);
    sendSlackNotification(predictionMessage, SLACK_PREDICTIONS_URL);

    if (probability >= 80) {
        const tradeMessage = `🚨 *High Confidence Trade Alert!*\n📉 *${probability}% probability* of a downtrend.\n💰 Consider placing a SELL trade!`;
        console.log(tradeMessage);
        sendSlackNotification(tradeMessage, SLACK_TRADE_ALERT_URL);
    }

    setTimeout(() => evaluatePrediction(probability), 7 * 60 * 1000);
};

// Evaluate prediction success rate
const evaluatePrediction = async (probability) => {
    const boomOccurred = lastBoomTime && (Date.now() - lastBoomTime) <= 7 * 60 * 1000;
    let predictionSuccess = probability < 60 ? boomOccurred : !boomOccurred;

    if (predictionSuccess) successCount++;
    else failureCount++;

    const totalPredictions = successCount + failureCount;
    const successRate = totalPredictions ? ((successCount / totalPredictions) * 100).toFixed(2) : 0;

    await db.none(
        "INSERT INTO prediction_reports (successful, failed, total, success_rate) VALUES ($1, $2, $3, $4)",
        [successCount, failureCount, totalPredictions, successRate]
    );

    const reportMessage = `📊 *Prediction Report*\n✅ Successful: ${successCount}\n❌ Failed: ${failureCount}\n📈 Total: ${totalPredictions}\n🎯 Success Rate: ${successRate}%`;
    console.log(reportMessage);
    sendSlackNotification(reportMessage, SLACK_REPORTS_URL);
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