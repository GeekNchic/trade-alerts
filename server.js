const express = require('express');
const cors = require('cors');
const { spawn, exec } = require('child_process');

const app = express();
const PORT = 3000;
app.use(cors());

let scriptProcess = null;
let activeStartTime = null;
let totalActiveTime = 0;
let totalInactiveTime = 0;
let lastStoppedTime = Date.now();

app.get('/start', (req, res) => {
    if (!scriptProcess) {
        scriptProcess = spawn('node', ['index.js']);
        scriptProcess.stdout.on('data', (data) => console.log(`Script: ${data}`));
        scriptProcess.stderr.on('data', (data) => console.error(`Error: ${data}`));

        activeStartTime = Date.now();
        totalInactiveTime += activeStartTime - lastStoppedTime;
        res.json({ status: 'ACTIVE' });
    } else {
        res.json({ status: 'Already Running' });
    }
});

app.get('/stop', (req, res) => {
    if (scriptProcess) {
        scriptProcess.kill();
        scriptProcess = null;

        totalActiveTime += Date.now() - activeStartTime;
        lastStoppedTime = Date.now();
        res.json({ status: 'INACTIVE' });
    } else {
        res.json({ status: 'Already Stopped' });
    }
});

app.get('/status', (req, res) => {
    const status = scriptProcess ? 'ACTIVE' : 'INACTIVE';
    res.json({
        status,
        totalActiveTime: (totalActiveTime + (scriptProcess ? Date.now() - activeStartTime : 0)) / 1000,
        totalInactiveTime: (totalInactiveTime + (!scriptProcess ? Date.now() - lastStoppedTime : 0)) / 1000,
    });
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
