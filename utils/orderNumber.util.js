// utils/orderNumber.util.js
import moment from 'moment-timezone';

const ORDER_NUMBER_PREFIX = 'PC';

/**
 * Formats the date part as DDMMYY
 * @param {Date} date
 * @returns {string}
 */
const formatDatePart = (date = new Date()) => {
    return moment(date).tz('Asia/Kolkata').format('DDMMYY');
};

/**
 * Generates an order number candidate given a date and a sequence.
 * Format: PCDDMMYYSSSS
 *
 * @param {Date} date The creation date of the order
 * @param {number} sequence The daily sequence number (starting from 1)
 * @returns {string} Example: PC1004260001
 */
export const generateOrderNumberCandidate = (date = new Date(), sequence = 1) => {
    const datePart = formatDatePart(date);
    const sequencePart = String(sequence).padStart(4, '0');

    return `${ORDER_NUMBER_PREFIX}${datePart}${sequencePart}`;
};
