// configs/socket.config.js
import { Server } from 'socket.io';
import env from '#configs/env';
import { registerSocketHandlers } from '#services/socket';

let io = null;

export const initSocketServer = (httpServer) => {
    if (io) {
        return io;
    }

    // Support both direct /socket.io and Nginx subpath /printcart24/socket.io
    httpServer.prependListener('request', (req, res) => {
        if (req.url && req.url.startsWith('/printcart24/socket.io')) {
            req.url = req.url.replace('/printcart24/socket.io', '/socket.io');
        }
    });
    httpServer.prependListener('upgrade', (req, socket, head) => {
        if (req.url && req.url.startsWith('/printcart24/socket.io')) {
            req.url = req.url.replace('/printcart24/socket.io', '/socket.io');
        }
    });

    const allowedOrigins = env.CORS_ORIGINS ? env.CORS_ORIGINS.split(',').map((o) => o.trim()) : [];

    io = new Server(httpServer, {
        path: '/socket.io',
        cors: {
            origin: (origin, callback) => {
                if (!origin) return callback(null, true);
                if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
                    return callback(null, true);
                }
                return callback(new Error('Not allowed by CORS'));
            },
            credentials: true,
        },
        transports: ['websocket', 'polling'],
    });

    registerSocketHandlers(io);

    return io;
};

export const getIO = () => {
    if (!io) {
        throw new Error('Socket.IO has not been initialized yet.');
    }
    return io;
};

export const getPrintCartNsp = () => {
    if (!io) {
        throw new Error('Socket.IO has not been initialized yet.');
    }
    return io.of('/printcart24');
};
