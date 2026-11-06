// ecosystem.config.cjs
// PM2 Process Configuration

module.exports = {
    apps: [
        {
            name: 'printcart24-api',
            script: './server.js',

            // Node flags
            node_args: '--env-file=/home/appsinvo/printcart24-backend-apis/.env',

            // Runtime strategy
            // Minimum 2 instances required for graceful zero-downtime reloads
            instances: 2,
            exec_mode: 'cluster',

            // Stability & resource control
            max_memory_restart: '1G',
            autorestart: true,

            // Production safety
            watch: false,
            merge_logs: true,

            // Graceful shutdown timeout
            kill_timeout: 5000,
        },
    ],
};
