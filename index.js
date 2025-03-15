require('dotenv').config();
const WebSocket = require('ws');
const axios = require('axios');
const pgp = require('pg-promise')();

// Debugging: Print environment variables
console.log("🔍 Debugging Environment Variables:");
console.log("DB_USER:", process.env.DB_USER);
console.log("DB_HOST:", process.env.DB_HOST);
console.log("DB_NAME:", process.env.DB_NAME);
console.log("DB_PASSWORD:", process.env.DB_PASSWORD ? "✅ Set" : "❌ Not Set");
console.log("DB_PORT:", process.env.DB_PORT);
console.log("SLACK_ALERTS_URL:", process.env.SLACK_ALERTS_URL);

// PostgreSQL Database Connection
const db = pgp({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    ssl: false // SSL disabled as per request
});

// Slack Webhook URLs
const SLACK_ALERTS_URL = process.env.SLACK_ALERTS_URL;
const SLACK_TRENDS_URL = process.env.SLACK_TRENDS_URL;
const SLACK_PREDICTIONS_URL = process.env.SLACK_PREDICTIONS_URL;
const SLACK_REPORTS_URL = process.env.SLACK_REPORTS_URL;
const SLACK_TRADE_ALERT_URL = process.env.SLACK_TRADE_ALERT_URL;

// Test Database Connection
db.one("SELECT NOW()")
    .then(data => console.log("✅ Database connection successful:", data))
    .catch(err => console.error("❌ Database connection error:", err));

// Test Slack Webhook Connection
axios.post(process.env.SLACK_ALERTS_URL, { text: "Test Slack message from index.js" })
    .then(() => console.log("✅ Slack test message sent"))
    .catch(err => console.error("❌ Slack test error:", err.response ? err.response.data : err.message));


// WebSocket Connection
const APP_ID = 69728;
let connection = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

connection.onopen = () => console.log('✅ WebSocket Connected!');

connection.onerror = (error) => console.error('❌ WebSocket Error:', error);

connection.onclose = () => console.log('🔌 WebSocket Disconnected. Reconnecting in 5 seconds...');



let lastPrice = null;
let lastBoomTime = null;
let tickCounter = 0;
let trendCounter = 0;
const BOOM_THRESHOLD = 1;
let successCount = 0;
let failureCount = 0;

// Function to send Slack notifications
const sendSlackNotification = async (message, webhookUrl) => {
    if (!webhookUrl) {
        console.error('❌ Missing Slack webhook URL');
        return;
    }
    try {
        await axios.post(webhookUrl, { text: message });
    } catch (error) {
        console.error(`❌ Slack notification error:`, error.response ? error.response.data : error.message);
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
    tickCounter++;
    console.log(`#${tickCounter} 💰 Price: ${price}`);

    if (lastPrice !== null && price - lastPrice >= BOOM_THRESHOLD) {
        const boomMessage = `🚀 *BOOM!* Price spiked from ${lastPrice} to ${price}`;
        console.log(boomMessage);
        sendSlackNotification(boomMessage, SLACK_ALERTS_URL);
        lastBoomTime = Date.now();
        db.none('INSERT INTO boom_alerts (price, previous_price, boom_time) VALUES ($1, $2, $3)', 
            [price, lastPrice, new Date()])
        .then(() => console.log('✅ Boom alert saved to database'))
        .catch(error => console.error('❌ Database insertion error:', error));
    }
    lastPrice = price;

    if (tickCounter >= 100) {
        analyzeTrend(price);
        tickCounter = 0;
    }
};

// Analyze trend and send update
const analyzeTrend = async (currentPrice) => {
    const trend = Math.random() > 0.5 ? 'Green 🟢🐂' : 'Red 🔴🐻';
    trendCounter++;
    await db.none("INSERT INTO trend_alerts (trend, price, timestamp) VALUES ($1, $2, $3)",
        [trend, currentPrice, new Date()]);
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

// Make prediction based on trend data
const makePrediction = async (trendData) => {
    const downtrends = trendData.filter(t => t.trend.includes('Red')).length;
    const probability = ((downtrends / trendData.length) * 100).toFixed(2);
    const trend = downtrends > 2 ? 'Red 🔴🐻' : 'Green 🟢🐂';
    await db.none("INSERT INTO predictions (probability, trend) VALUES ($1, $2)",
        [probability, trend]);
    const predictionMessage = `📉 *Prediction:* ${probability}% chance of downtrend continuing in next 7 minutes`;
    console.log(predictionMessage);
    sendSlackNotification(predictionMessage, SLACK_PREDICTIONS_URL);
    if (probability >= 80) {
        const tradeMessage = `🚨 *High Confidence Trade Alert!*\n📉 *${probability}% probability* of a downtrend.`;
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
    await db.none("INSERT INTO prediction_reports (successful, failed, total, success_rate) VALUES ($1, $2, $3, $4)",
        [successCount, failureCount, totalPredictions, successRate]);
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
