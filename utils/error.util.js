// utils/error.util.js
import fs from 'fs';
import path from 'path';
import moment from 'moment-timezone';

/**
 * ### Error Handler
 */
const errorHandler = (err, req, res, next) => {
    // Store the error in a separate file
    storeError(err, req);

    const statusCode = err.status || 500;

    res.status(statusCode).json({
        status: false,
        message: err.message || 'Internal Server Error',
        requestId: req.id, // expose for debugging
        ...(err.data !== undefined && { data: err.data }),
    });
};

export default errorHandler;

/**
 * ### Function to store error messages in a log file
 */
const logDir = path.resolve('public/logs');
const logFile = path.join(logDir, 'error.log');

export const storeError = (error, req) => {
    try {
        const currentTime = moment().tz('Asia/Kolkata').format('DD-MM-YYYY, h:mm:ss A');

        let errorDetails = '';
        if (error) {
            if (error.stack) {
                errorDetails = error.stack;
            } else if (typeof error === 'object') {
                errorDetails = error.message
                    ? `Error: ${error.message}\nDetails: ${JSON.stringify(error, null, 2)}`
                    : JSON.stringify(error, null, 2);
            } else {
                errorDetails = String(error);
            }
        }

        const errorMessage = `
[${currentTime}]
[REQ_ID: ${req?.id}]
${req?.method} ${req?.originalUrl}

${errorDetails}
--------------------------------------------------
`;

        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        fs.appendFile(logFile, errorMessage, (err) => {
            if (err) console.error('Log write failed:', err);
        });
    } catch (err) {
        console.error('Logger failure:', err);
    }
};
