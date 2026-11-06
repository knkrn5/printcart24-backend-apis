// configs/redis.config.js
import env from '#configs/env';
import { createClient } from 'redis';

class RedisClient {
    constructor() {
        this.client = null;
        this.isConnected = false;
    }

    /**
     * Initialize Redis connection
     */
    async connect() {
        if (!env.ENABLE_REDIS) {
            console.log('⚪ Redis is disabled via configuration');
            return;
        }

        try {
            const redisUrl = env.REDIS_URL || 'redis://localhost:6379';
            this.client = createClient({
                url: redisUrl,
                socket: {
                    reconnectStrategy: (retries) => {
                        console.log(`Redis reconnect attempt: ${retries}`);
                        return Math.min(retries * 100, 3000); // exponential backoff
                    },
                    keepAlive: 5000, // <-- important
                },
            });

            this.client.on('connect', () => {
                console.log('🔵 Redis connecting...');
            });

            this.client.on('ready', () => {
                this.isConnected = true;
                console.log('🟢 Redis connected');
            });

            this.client.on('error', (err) => {
                this.isConnected = false;
                console.error('🔴 Redis error:', {
                    message: err.message,
                    code: err.code,
                });
            });

            this.client.on('end', () => {
                this.isConnected = false;
                console.warn('🟡 Redis connection closed');
            });

            await this.client.connect();

            setInterval(async () => {
                try {
                    if (this.client?.isOpen) {
                        await this.client.ping();
                    }
                } catch (err) {
                    console.error('Redis ping failed:', err.message);
                }
            }, 30000); // every 30s
        } catch (error) {
            console.error('❌ Redis connection failed:', error.message);
        }
    }

    /**
     * Check connection status
     */
    isAlive() {
        return this.isConnected;
    }

    /**
     * Set key in Redis
     * @param {string} key
     * @param {any} value
     * @param {number} ttl - time in seconds (optional)
     */
    async set(key, value, ttl = null) {
        try {
            if (!env.ENABLE_REDIS || !this.client?.isOpen) {
                if (env.ENABLE_REDIS) console.warn('Redis not ready, skipping operation');
                return;
            }

            const data = JSON.stringify(value);

            if (ttl) {
                await this.client.setEx(key, ttl, data);
            } else {
                await this.client.set(key, data);
            }
        } catch (error) {
            console.error('Redis SET error:', error.message);
        }
    }

    /**
     * Get key from Redis
     * @param {string} key
     * @returns {any}
     */
    async get(key) {
        try {
            if (!env.ENABLE_REDIS || !this.client?.isOpen) {
                if (env.ENABLE_REDIS) console.warn('Redis not ready, skipping operation');
                return null;
            }

            const data = await this.client.get(key);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            console.error('Redis GET error:', error.message);
            return null;
        }
    }

    /**
     * Delete key
     */
    async del(key) {
        try {
            if (!env.ENABLE_REDIS || !this.client?.isOpen) {
                if (env.ENABLE_REDIS) console.warn('Redis not ready, skipping operation');
                return;
            }

            await this.client.del(key);
        } catch (error) {
            console.error('Redis DEL error:', error.message);
        }
    }

    /**
     * Flush all (use carefully)
     */
    async flush() {
        try {
            if (!env.ENABLE_REDIS || !this.client?.isOpen) {
                if (env.ENABLE_REDIS) console.warn('Redis not ready, skipping operation');
                return;
            }

            await this.client.flushAll();
        } catch (error) {
            console.error('Redis FLUSH error:', error.message);
        }
    }
}

const redisClient = new RedisClient();

export default redisClient;
