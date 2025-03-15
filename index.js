require('dotenv').config();
const WebSocket = require('ws');
const axios = require('axios');
const pgp = require('pg-promise')();
const winston = require('winston');

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
const APP_ID = process.env.APP_ID || '69728';
const DERIV_URL = `wss://ws.binaryws.com/websockets/v3?app_id=${APP_ID}`;
let connection;
const MAX_RECONNECT_ATTEMPTS = 5;
let reconnectAttempts = 0;

// Slack Webhooks
const SLACK_ALERTS_URL = process.env.SLACK_ALERTS_URL;
const SLACK_TRENDS_URL = process.env.SLACK_TRENDS_URL;

// Tracking variables
let lastPrice = null;
let lastBoomTime = null;
let tickCounter = 0;
let trendCounter = 0;
const BOOM_THRESHOLD = 1;

// Logger setup
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}]: ${message}`)
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'app.log' })
    ]
});

// Function to send Slack notifications
const sendSlackNotification = async (message, webhookUrl) => {
    try {
        await axios.post(webhookUrl, { text: message });
    } catch (error) {
        console.error('❌ Slack notification error:', error);
    }
};

// Function to establish WebSocket connection
const connectWebSocket = () => {
    connection = new WebSocket(DERIV_URL);
    
    connection.onopen = () => {
        console.log('✅ WebSocket Connected! Subscribing to ticks...');
        connection.send(JSON.stringify({ ticks: 'BOOM500', subscribe: 1 }));
        reconnectAttempts = 0;
    };
    
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
    
    connection.onerror = (error) => {
        console.error('❌ WebSocket Error:', error);
    };
    
    connection.onclose = () => {
        console.log('🔌 WebSocket Disconnected. Reconnecting...');
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            setTimeout(connectWebSocket, 5000);
        } else {
            console.error('❌ Max reconnect attempts reached.');
        }
    };
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

        db.none('INSERT INTO boom_alerts (price, previous_price, boom_time) VALUES ($1, $2, $3)', [price, lastPrice, timestamp])
            .then(() => console.log('✅ Boom alert saved to database'))
            .catch(error => console.error('❌ Database insertion error:', error));
    }
    lastPrice = price;
};

// Start WebSocket connection
connectWebSocket();