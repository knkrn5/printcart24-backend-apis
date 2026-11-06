// server.js
import server from '#configs/app';
import { dbConnection } from '#configs/db';
import env from '#configs/env';
import chalk from 'chalk';
import mongoose from 'mongoose';
import { checkAdminExists } from '#utils/checkAdmin';
import { startScheduler } from '#configs/scheduler';
import redisClient from '#configs/redis';
import { initSocketServer } from '#configs/socket';

const PORT = env.PORT || 5100;

// Connect to Redis
(async () => {
    await redisClient.connect();
})();

// Initialize Socket.IO
initSocketServer(server);

// Initialize MongoDB
dbConnection()
    .then(async () => {
        // Mandatory check if ADMIN exists
        await checkAdminExists();
        startScheduler();

        server.listen(PORT, () => {
            console.log(`Server running on http://localhost:${PORT}`);
        });
    })
    .catch((error) => {
        console.log(chalk.bgRed(`Failed to start server: ${error.message}`));
        process.exit(1);
    });

process.on('SIGINT', async () => {
    console.log('Shutting down server...');
    await mongoose.connection.close();
    server.close(() => process.exit(0));
});

process.on('SIGTERM', async () => {
    console.log('Shutting down server...');
    await mongoose.connection.close();
    server.close(() => process.exit(0));
});
