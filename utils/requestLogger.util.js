// utils/requestLogger.util.js
import chalk from 'chalk';
import moment from 'moment-timezone';

/**
 * Express middleware for logging method + URL with timestamp
 */
export function requestLogger(req, res, next) {
    const color = getMethodColor(req.method);
    const timestamp = chalk.cyan(getFormattedTimestamp());

    // With Timestamp
    console.log(`${timestamp} ${color(req.method)} ${chalk.gray(req.url)}`);
    // Without Timestamp
    // console.log(`${color(req.method)} ${chalk.gray(req.url)}`);

    next();
}

/**
 * Get color for HTTP method
 */
export function getMethodColor(method) {
    switch (method) {
        case 'GET':
            return chalk.green;
        case 'POST':
            return chalk.blue;
        case 'PUT':
        case 'PATCH':
            return chalk.yellow;
        case 'DELETE':
            return chalk.red;
        default:
            return chalk.white;
    }
}

/**
 * Generate formatted timestamp
 * Format: [DD-MM-YYYY HH:mm:ss Hrs]
 * Timezone fixed to Asia/Kolkata
 */
export function getFormattedTimestamp() {
    return `[${moment().tz('Asia/Kolkata').format('DD-MM-YYYY HH:mm:ss [Hrs]')}]`;
}
