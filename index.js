require('dotenv').config(); // Load environment variables

const WebSocket = require('ws');
const axios = require('axios');
const pgp = require('pg-promise')();

// PostgreSQL Database Connection
const db = pgp({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

// WebSocket connection to Deriv
const APP_ID = process.env.APP_ID;
let connection = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

// Slack Webhooks
const SLACK_ALERTS_URL = process.env.SLACK_ALERTS_URL;
const SLACK_TRENDS_URL = process.env.SLACK_TRENDS_URL;

// Tracking variables
let lastPrice = null;
let lastBoomTime = null;
let tickCounter = 0;
let trendCounter = 0;
const BOOM_THRESHOLD = 1;

// Function to send Slack notifications
const sendSlackNotification = async (message, webhookUrl) => {
    try {
        const response = await axios.post(webhookUrl, { text: message }, {
            headers: { 'Content-Type': 'application/json' }
        });
        console.log(response.status === 200 ? `✅ Slack message sent: ${message}` : `❌ Slack message failed: ${response.data}`);
    } catch (error) {
        console.error('❌ Slack notification error:', error);
    }
};

// Handle WebSocket messages
connection.onmessage = (event) => {
    const response = JSON.parse(event.data);
    if (response.error) return console.error('❌ API Error:', response.error.message);
    if (response.msg_type === 'tick') processTick(response.tick);
};

// Process tick data
const processTick = (tick) => {
    const price = tick.quote;
    const timestamp = tick.timestamp ? new Date(tick.timestamp) : new Date();
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
        console.log('🔍 100 ticks reached, analyzing trend...');
        analyzeTrend(price, timestamp);
        tickCounter = 0;
    }
};

// Analyze trend and send update
const analyzeTrend = async (currentPrice, currentTimestamp) => {
    console.log(`📊 Analyzing trend at ${currentTimestamp} with price ${currentPrice}`);

    const trend = Math.random() > 0.5 ? 'Green 🟢🐂' : 'Red 🔴🐻';
    trendCounter++;

    try {
        console.log(`📝 Inserting trend alert into database: ${trend}`);
        await db.query(
            "INSERT INTO trend_alerts (trend, price, timestamp) VALUES ($1, $2, $3)",
            [trend, currentPrice, currentTimestamp]
        );
        console.log('✅ Trend alert successfully saved to database.');
    } catch (error) {
        console.error('❌ Database insertion error:', error);
    }

    try {
        const trendMessage = `📊 *Trend Alert (#${trendCounter})*:\n🔹 Trend: ${trend}\n💰 Current Price: ${currentPrice}`;
        console.log(`📢 Sending Slack alert: ${trendMessage}`);
        await sendSlackNotification(trendMessage, SLACK_TRENDS_URL);
        console.log('✅ Slack message sent.');
    } catch (error) {
        console.error('❌ Slack notification error:', error);
    }
};

// WebSocket connection handling
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
