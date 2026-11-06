// utils/firebase.util.js
import firebaseAdmin from '#configs/firebase';
import User from '#models/user';
import chalk from 'chalk';

/**
 * Sends a push notification to one or multiple devices efficiently.
 */
export const sendPushNotification = async (deviceTokens, title, body, metadata = {}) => {
    // Normalize single token string to an array
    const tokensArray = Array.isArray(deviceTokens) ? deviceTokens : [deviceTokens];

    // Filter out invalid or empty tokens
    const validTokensArray = tokensArray.filter((token) => token && typeof token === 'string' && token.trim() !== '');

    if (validTokensArray.length === 0) {
        console.log('No valid device tokens provided. Skipping notification.');
        return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }

    const data = typeof metadata === 'string' ? { metadata } : JSON.stringify(metadata);

    const message = {
        notification: {
            title,
            body,
        },
        data: {
            title,
            body,
            data,
        },
        tokens: validTokensArray, // The array of valid device tokens
    };

    try {
        const batchResponse = await firebaseAdmin.messaging().sendEachForMulticast(message);
        console.log(`${batchResponse.successCount} messages were sent successfully`);

        const invalidTokens = [];
        if (batchResponse.failureCount > 0) {
            batchResponse.responses.forEach(async (resp, idx) => {
                if (!resp.success) {
                    const failedToken = validTokensArray[idx];
                    const errorCode = resp.error.code;

                    if (
                        errorCode === 'messaging/registration-token-not-registered' ||
                        errorCode === 'messaging/invalid-registration-token'
                    ) {
                        console.log('ErrorCode:', errorCode);
                        console.log(`Token ${failedToken} is invalid. Marking for removal.`);
                        // Remove invalid tokens from user data
                        await User.findOneAndUpdate({ fcmToken: failedToken }, { $set: { fcmToken: '' } });
                        invalidTokens.push(failedToken);
                    } else {
                        console.error(`Failed to send to token ${failedToken}:`, resp.error);
                    }
                }
            });
        }

        return {
            successCount: batchResponse.successCount,
            failureCount: batchResponse.failureCount,
            invalidTokens: invalidTokens,
        };
    } catch (error) {
        console.error(chalk.red('Error sending multicast notification: '), error);
        return { successCount: 0, failureCount: validTokensArray.length, invalidTokens: [] };
    }
};
