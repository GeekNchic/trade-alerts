require('dotenv').config();
console.log('Database Host:', process.env.DB_HOST); // Debugging

const WebSocket = require('ws');
const axios = require('axios');
const pgp = require('pg-promise')();
const winston = require('winston'); // Logging

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
const APP_ID = process.env.APP_ID || '1089'; // Default APP_ID if not set
const DERIV_URL = `wss://ws.binaryws.com/websockets/v3?app_id=${APP_ID}`;
let connection = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// Slack Webhooks
const SLACK_ALERTS_URL = process.env.SLACK_ALERTS_URL;
const SLACK_TRENDS_URL = process.env.SLACK_TRENDS_URL;

// Tracking variables
let lastPrice = null;
let lastBoomTime = null;
let tickCounter = 0;
let trendCounter = 0;
let priceHistory = [];
const BOOM_THRESHOLD = 1;
const SMA_PERIOD = 10; // Simple Moving Average period

// Logger setup
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}]: ${message}`)
    ),
    transports: [new winston.transports.Console(), new winston.transports.File({ filename: 'app.log' })]
});

// Function to send Slack notifications
const sendSlackNotification = async (message, webhookUrl) => {
    try {
        await axios.post(webhookUrl, { text: message }, { headers: { 'Content-Type': 'application/json' } });
        logger.info(`✅ Slack message sent: ${message}`);
    } catch (error) {
        logger.error(`❌ Slack notification error: ${error.message}`);
    }
};

// WebSocket Connection Handling
const connectWebSocket = () => {
    if (connection) {
        connection.close();
        connection = null;
    }

    connection = new WebSocket(DERIV_URL);

    connection.onopen = () => {
        logger.info('✅ WebSocket Connected! Subscribing to ticks...');
        connection.send(JSON.stringify({ ticks: 'BOOM500', subscribe: 1 }));
        reconnectAttempts = 0;
    };

    connection.onerror = (error) => logger.error(`❌ WebSocket Error: ${error.message}`);

    connection.onclose = () => {
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            const waitTime = Math.pow(2, reconnectAttempts) * 1000; // Exponential backoff
            logger.warn(`🔌 WebSocket Disconnected. Reconnecting in ${waitTime / 1000}s...`);
            reconnectAttempts++;
            setTimeout(connectWebSocket, waitTime);
        } else {
            logger.error('❌ Max reconnection attempts reached. Manual intervention required.');
        }
    };

    connection.onmessage = (event) => {
        const response = JSON.parse(event.data);
        if (response.error) return logger.error(`❌ API Error: ${response.error.message}`);
        if (response.msg_type === 'tick') processTick(response.tick);
    };
};

// Process tick data
const processTick = (tick) => {
    const price = tick.quote;
    const timestamp = tick.timestamp ? new Date(tick.timestamp) : new Date();
    tickCounter++;
    priceHistory.push(price);

    logger.info(`#${tickCounter} 💰 Price: ${price}`);

    if (lastPrice !== null && price - lastPrice >= BOOM_THRESHOLD) {
        const boomMessage = `🚀 *BOOM!* Price spiked from ${lastPrice} to ${price}`;
        logger.info(boomMessage);
        sendSlackNotification(boomMessage, SLACK_ALERTS_URL);
        lastBoomTime = timestamp;

        // Insert boom alert into the database using transaction
        db.tx(t => {
            return t.none('INSERT INTO boom_alerts (price, previous_price, boom_time) VALUES ($1, $2, $3)', 
                [price, lastPrice, timestamp]);
        })
        .then(() => logger.info('✅ Boom alert saved to database'))
        .catch(error => logger.error(`❌ Database insertion error: ${error.message}`));
    }

    lastPrice = price;

    if (tickCounter >= SMA_PERIOD) {
        analyzeTrend(price, timestamp);
        tickCounter = 0;
        priceHistory = priceHistory.slice(-SMA_PERIOD); // Keep last N prices
    }
};

// Analyze trend using a simple moving average (SMA)
const analyzeTrend = async (currentPrice, currentTimestamp) => {
    const sma = priceHistory.reduce((sum, p) => sum + p, 0) / priceHistory.length;
    const trend = currentPrice > sma ? 'Green 🟢🐂' : 'Red 🔴🐻';
    trendCounter++;

    logger.info(`📊 Analyzing trend at ${currentTimestamp}: Current Price = ${currentPrice}, SMA = ${sma}`);

    try {
        await db.tx(t => {
            return t.none("INSERT INTO trend_alerts (trend, price, timestamp) VALUES ($1, $2, $3)",
                [trend, currentPrice, currentTimestamp]);
        });
        logger.info('✅ Trend alert successfully saved to database.');
    } catch (error) {
        logger.error(`❌ Database insertion error: ${error.message}`);
    }

    try {
        const trendMessage = `📊 *Trend Alert (#${trendCounter})*:\n🔹 Trend: ${trend}\n💰 Current Price: ${currentPrice}`;
        logger.info(`📢 Sending Slack alert: ${trendMessage}`);
        await sendSlackNotification(trendMessage, SLACK_TRENDS_URL);
    } catch (error) {
        logger.error(`❌ Slack notification error: ${error.message}`);
    }
};

// Start WebSocket Connection
connectWebSocket();
