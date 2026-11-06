// configs/app.config.js
import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import http from 'http';
import cors from 'cors';
import errorHandler from '#utils/error';
import router from '#root/routes/index';
import { requestLogger } from '#utils/requestLogger';
import env from '#configs/env';
import { requestIdMiddleware } from '#utils/requestId';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

app.use(requestIdMiddleware); // Request Id Middleware for tracking requests
app.use(requestLogger); // Log the requests

const allowedOrigins = env.CORS_ORIGINS ? env.CORS_ORIGINS.split(',').map((o) => o.trim()) : [];

console.log('CORS Allowed Origins:', allowedOrigins);
const corsOptions = {
    origin: (origin, callback) => {
        // Allow requests like Postman / curl with no origin
        if (!origin) {
            return callback(null, true);
        }

        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        } else {
            console.warn(`[CORS] BLOCKED → ${origin}`);
            return callback(null, false);
        }
    },
    credentials: true,
};
app.use(cors(corsOptions));

app.use(express.json({ limit: '2048mb' }));
app.use(express.urlencoded({ limit: '2048mb', extended: true }));
app.use(express.static(path.resolve(__dirname, '../public')));

if (!fs.existsSync(path.resolve(__dirname, '../public'))) {
    fs.mkdirSync(path.resolve(__dirname, '../public'), { recursive: true });
}

// Serve Error logs
const pathToErrorLogs = path.join(__dirname, '../', 'public', 'logs');
app.use('/logs', express.static(pathToErrorLogs));

app.use('/api', router); // serve all routes here

app.get('/', (_, res) => {
    res.status(200).json({
        status: true,
        message: 'Welcome to the Printcart24 API',
    });
});

app.use(errorHandler);

export default server;
