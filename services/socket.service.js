// services/socket.service.js
import jwt from 'jsonwebtoken';
import chalk from 'chalk';
import env from '#configs/env';
import Partner from '#models/partner';
import User from '#models/user';
import PrintOrder from '#models/printOrder';
import { isValidObjectId } from '#utils/generalHelper';

/**
 * Socket.IO connection authentication middleware.
 * Authenticates riders and customers using existing JWT tokens.
 * Enforces handshake.auth.token or headers.authorization only (query-param auth removed).
 */
export const verifySocketToken = async (socket, next) => {
    try {
        const authHeader = socket.handshake.auth?.token || socket.handshake.headers?.authorization;
        console.log('socket.handshake.auth?.token: ', socket.handshake.auth?.token);

        const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;

        if (!token) {
            console.log(chalk.red('[Socket:/printcart24:Auth] Connection rejected: Authentication token missing.'));
            return next(new Error('Authentication required. Please provide a valid token.'));
        }

        let decoded;
        try {
            decoded = jwt.verify(token, env.ACCESS_TOKEN_SECRET);
        } catch (jwtErr) {
            console.log(
                chalk.red(
                    `[Socket:/printcart24:Auth] Connection rejected: Invalid or expired token (${jwtErr.message}).`,
                ),
            );
            return next(new Error('Invalid or expired authentication token.'));
        }

        // 1. Rider authentication
        if (decoded.role === 'rider') {
            const partner = await Partner.findById(decoded.id).select('_id role accountStatus isActive isDeleted');

            if (!partner || partner.isDeleted) {
                console.log(
                    chalk.red(
                        `[Socket:/printcart24:Auth] Rider session invalid: Partner ${decoded.id} not found or deleted.`,
                    ),
                );
                return next(new Error('Invalid session. Partner not found.'));
            }

            if (!partner.isActive) {
                console.log(
                    chalk.red(`[Socket:/printcart24:Auth] Rider access denied: Partner ${decoded.id} is inactive.`),
                );
                return next(new Error('Partner account is inactive. Please contact support.'));
            }

            if (partner.accountStatus !== 'ACTIVE') {
                console.log(
                    chalk.red(
                        `[Socket:/printcart24:Auth] Rider access denied: Partner account status is ${partner.accountStatus}.`,
                    ),
                );
                return next(
                    new Error(`Your account is currently ${partner.accountStatus.toLowerCase()}. Access denied.`),
                );
            }

            socket.data.user = {
                id: partner._id.toString(),
                role: 'rider',
                accountStatus: partner.accountStatus,
            };

            return next();
        }

        // 2. Customer / User authentication
        const user = await User.findById(decoded.id).select('_id role isActive isDeleted');

        if (!user || user.isDeleted) {
            console.log(
                chalk.red(
                    `[Socket:/printcart24:Auth] Customer session invalid: User ${decoded.id} not found or deleted.`,
                ),
            );
            return next(new Error('Invalid session. User not found.'));
        }

        if (!user.isActive) {
            console.log(
                chalk.red(`[Socket:/printcart24:Auth] Customer access denied: User ${decoded.id} is inactive.`),
            );
            return next(new Error('Account is inactive. Contact support.'));
        }

        socket.data.user = {
            id: user._id.toString(),
            role: user.role || 'user',
        };

        return next();
    } catch (error) {
        console.log(chalk.red(`[Socket:/printcart24:Auth] Authentication exception: ${error.message}`));
        next(new Error(`Authentication failed: ${error.message}`));
    }
};

/**
 * Registers all PrintCart24 socket events and middleware under the /printcart24 namespace.
 * @param {import('socket.io').Server} io
 */
export const registerSocketHandlers = (io) => {
    // Dedicated namespace for PrintCart24
    const printcartNsp = io.of('/printcart24');

    // Apply unified authentication middleware to /printcart24 namespace
    printcartNsp.use(verifySocketToken);

    printcartNsp.on('connection', (socket) => {
        const userRole = socket.data.user?.role || 'unknown';
        const userId = socket.data.user?.id || 'unknown';

        // 1. Log client connected
        console.log(
            chalk.cyan(
                `[Socket:/printcart24:Connect] Client connected: socketId=${socket.id} | role=${userRole} | userId=${userId}`,
            ),
        );

        // 2. Log client disconnected
        socket.on('disconnect', (reason) => {
            console.log(
                chalk.gray(
                    `[Socket:/printcart24:Disconnect] Client disconnected: socketId=${socket.id} | role=${userRole} | userId=${userId} | reason=${reason}`,
                ),
            );
        });

        /**
         * Rider Location Update
         * Event: rider:location_update
         * Payload: { orderId, latitude, longitude, updatedAt }
         */
        socket.on('rider:location_update', async (payload, callback) => {
            const sendAck = (response) => {
                if (typeof callback === 'function') {
                    callback(response);
                }
            };

            try {
                if (socket.data.user?.role !== 'rider') {
                    console.log(
                        chalk.yellow(
                            `[Socket:/printcart24:Rider] Location update blocked: socketId=${socket.id} has non-rider role (${socket.data.user?.role}).`,
                        ),
                    );
                    return sendAck({
                        success: false,
                        code: 'UNAUTHORIZED_ROLE',
                        message: 'Only riders can send location updates.',
                    });
                }

                if (!payload || typeof payload !== 'object') {
                    console.log(
                        chalk.yellow(
                            `[Socket:/printcart24:Rider] Location update rejected: invalid payload format from riderId=${userId}.`,
                        ),
                    );
                    return sendAck({
                        success: false,
                        code: 'INVALID_PAYLOAD',
                        message: 'Payload must be an object containing orderId, latitude, and longitude.',
                    });
                }

                const { orderId, latitude, longitude, updatedAt } = payload;

                // Validate orderId
                if (!orderId || !isValidObjectId(orderId)) {
                    console.log(
                        chalk.yellow(
                            `[Socket:/printcart24:Rider] Location update rejected: invalid orderId (${orderId}) from riderId=${userId}.`,
                        ),
                    );
                    return sendAck({
                        success: false,
                        code: 'INVALID_ORDER_ID',
                        message: 'Invalid or missing orderId.',
                    });
                }

                // Validate coordinates
                if (
                    typeof latitude !== 'number' ||
                    Number.isNaN(latitude) ||
                    latitude < -90 ||
                    latitude > 90 ||
                    typeof longitude !== 'number' ||
                    Number.isNaN(longitude) ||
                    longitude < -180 ||
                    longitude > 180
                ) {
                    console.log(
                        chalk.yellow(
                            `[Socket:/printcart24:Rider] Location update rejected: invalid coordinates (${latitude}, ${longitude}) for orderId=${orderId}.`,
                        ),
                    );
                    return sendAck({
                        success: false,
                        code: 'INVALID_COORDINATES',
                        message: 'Latitude must be between -90 and 90, and longitude between -180 and 180.',
                    });
                }

                // Validate timestamp (default to server time if omitted)
                let timestamp;
                if (updatedAt !== undefined && updatedAt !== null && updatedAt !== '') {
                    const parsedDate = new Date(updatedAt);
                    if (Number.isNaN(parsedDate.getTime())) {
                        console.log(
                            chalk.yellow(
                                `[Socket:/printcart24:Rider] Location update rejected: invalid timestamp (${updatedAt}) for orderId=${orderId}.`,
                            ),
                        );
                        return sendAck({
                            success: false,
                            code: 'INVALID_TIMESTAMP',
                            message: 'Invalid updatedAt timestamp provided.',
                        });
                    }
                    timestamp = parsedDate;
                } else {
                    timestamp = new Date();
                }

                // Log location update received
                console.log(
                    chalk.blue(
                        `[Socket:/printcart24:Rider] Location update received: riderId=${userId} | orderId=${orderId} | lat=${latitude} | lng=${longitude} | updatedAt=${timestamp.toISOString()}`,
                    ),
                );

                // Pre-check order eligibility and ownership
                const existingOrder = await PrintOrder.findById(orderId).select(
                    '_id orderNumber deliveryMode assignedPartner orderStatus currentLocation',
                );

                if (!existingOrder) {
                    console.log(
                        chalk.yellow(
                            `[Socket:/printcart24:Rider] Location update rejected: orderId=${orderId} not found in database.`,
                        ),
                    );
                    return sendAck({
                        success: false,
                        code: 'ORDER_NOT_FOUND',
                        message: 'Order not found.',
                    });
                }

                if (
                    !existingOrder.assignedPartner ||
                    existingOrder.assignedPartner.toString() !== socket.data.user.id
                ) {
                    console.log(
                        chalk.yellow(
                            `[Socket:/printcart24:Rider] Location update rejected: riderId=${userId} is not assigned to orderId=${orderId}.`,
                        ),
                    );
                    return sendAck({
                        success: false,
                        code: 'UNAUTHORIZED_RIDER',
                        message: 'You are not assigned to this order.',
                    });
                }

                if (existingOrder.deliveryMode !== 'DELIVERY') {
                    console.log(
                        chalk.yellow(
                            `[Socket:/printcart24:Rider] Location update rejected: orderId=${orderId} is ${existingOrder.deliveryMode}, not DELIVERY.`,
                        ),
                    );
                    return sendAck({
                        success: false,
                        code: 'INVALID_DELIVERY_MODE',
                        message: 'Only delivery orders support location tracking.',
                    });
                }

                if (!['DISPATCHED', 'REATTEMPT'].includes(existingOrder.orderStatus)) {
                    console.log(
                        chalk.yellow(
                            `[Socket:/printcart24:Rider] Location update rejected: orderId=${orderId} status '${existingOrder.orderStatus}' is not eligible.`,
                        ),
                    );
                    return sendAck({
                        success: false,
                        code: 'INVALID_ORDER_STATUS',
                        message: `Location update not allowed for order with status '${existingOrder.orderStatus}'.`,
                    });
                }

                // Atomic update at MongoDB level to strictly prevent race conditions / stale updates
                const updatedOrder = await PrintOrder.findOneAndUpdate(
                    {
                        _id: existingOrder._id,
                        assignedPartner: socket.data.user.id,
                        deliveryMode: 'DELIVERY',
                        orderStatus: { $in: ['DISPATCHED', 'REATTEMPT'] },
                        $or: [
                            { 'currentLocation.updatedAt': null },
                            { 'currentLocation.updatedAt': { $lt: timestamp } },
                        ],
                    },
                    {
                        $set: {
                            'currentLocation.latitude': latitude,
                            'currentLocation.longitude': longitude,
                            'currentLocation.updatedAt': timestamp,
                        },
                    },
                    {
                        returnDocument: 'after',
                        select: '_id orderNumber currentLocation orderStatus',
                    },
                );

                if (!updatedOrder) {
                    const currentDoc = await PrintOrder.findById(existingOrder._id).select('currentLocation');
                    console.log(
                        chalk.yellow(
                            `[Socket:/printcart24:Rider] Stale location ignored: orderId=${orderId} | incoming=${timestamp.toISOString()} | stored=${currentDoc?.currentLocation?.updatedAt?.toISOString?.() || currentDoc?.currentLocation?.updatedAt}`,
                        ),
                    );
                    return sendAck({
                        success: false,
                        code: 'STALE_LOCATION',
                        message:
                            'Location update ignored: received timestamp is older than or equal to current stored location.',
                        currentUpdatedAt: currentDoc?.currentLocation?.updatedAt || null,
                    });
                }

                // Log successful location persistence
                console.log(
                    chalk.green(
                        `[Socket:/printcart24:DB] Location persisted: orderId=${updatedOrder._id} | lat=${updatedOrder.currentLocation.latitude} | lng=${updatedOrder.currentLocation.longitude} | updatedAt=${updatedOrder.currentLocation.updatedAt.toISOString()}`,
                    ),
                );

                // Broadcast order:location_update within /printcart24 namespace room
                const roomName = `order:${updatedOrder._id}`;
                const roomClients = printcartNsp.adapter.rooms.get(roomName)?.size || 0;

                const locationBroadcastPayload = {
                    orderId: updatedOrder._id.toString(),
                    currentLocation: {
                        latitude: updatedOrder.currentLocation.latitude,
                        longitude: updatedOrder.currentLocation.longitude,
                        updatedAt: updatedOrder.currentLocation.updatedAt,
                    },
                };

                printcartNsp.to(roomName).emit('order:location_update', locationBroadcastPayload);

                console.log(
                    chalk.magentaBright(
                        `[Socket:/printcart24:Broadcast] order:location_update emitted: orderId=${updatedOrder._id} | room=${roomName} | subscribers=${roomClients} | lat=${updatedOrder.currentLocation.latitude} | lng=${updatedOrder.currentLocation.longitude}`,
                    ),
                );

                return sendAck({
                    success: true,
                    message: 'Location updated successfully.',
                    data: {
                        orderId: updatedOrder._id,
                        orderNumber: updatedOrder.orderNumber,
                        latitude: updatedOrder.currentLocation.latitude,
                        longitude: updatedOrder.currentLocation.longitude,
                        updatedAt: updatedOrder.currentLocation.updatedAt,
                    },
                });
            } catch (error) {
                console.log(
                    chalk.red(`[Socket:/printcart24:Rider] Exception in rider:location_update: ${error.message}`),
                );
                return sendAck({
                    success: false,
                    code: 'INTERNAL_ERROR',
                    message: 'Internal server error processing location update.',
                });
            }
        });

        /**
         * Customer Join Order Tracking Room
         * Event: join:order_tracking
         * Payload: { orderId }
         */
        socket.on('join:order_tracking', async (payload, callback) => {
            const sendAck = (response) => {
                if (typeof callback === 'function') {
                    callback(response);
                }
            };

            try {
                if (!payload || typeof payload !== 'object') {
                    console.log(
                        chalk.yellow(
                            `[Socket:/printcart24:Customer] join:order_tracking rejected: invalid payload from customerId=${userId}.`,
                        ),
                    );
                    return sendAck({
                        success: false,
                        code: 'INVALID_PAYLOAD',
                        message: 'Payload must be an object containing orderId.',
                    });
                }

                const { orderId } = payload;

                if (!orderId || !isValidObjectId(orderId)) {
                    console.log(
                        chalk.yellow(
                            `[Socket:/printcart24:Customer] join:order_tracking rejected: invalid orderId (${orderId}) from customerId=${userId}.`,
                        ),
                    );
                    return sendAck({
                        success: false,
                        code: 'INVALID_ORDER_ID',
                        message: 'Invalid or missing orderId.',
                    });
                }

                // Verify user owns the order
                const order = await PrintOrder.findOne({
                    _id: orderId,
                    user: socket.data.user.id,
                }).select('_id orderNumber currentLocation deliveryMode orderStatus');

                if (!order) {
                    console.log(
                        chalk.yellow(
                            `[Socket:/printcart24:Customer] join:order_tracking failed: customerId=${userId} does not own orderId=${orderId} (status=FAILED).`,
                        ),
                    );
                    return sendAck({
                        success: false,
                        code: 'UNAUTHORIZED_ORDER_ACCESS',
                        message: 'Order not found or you do not have permission to track this order.',
                    });
                }

                const roomName = `order:${order._id}`;
                await socket.join(roomName);

                const currentRoomSize = printcartNsp.adapter.rooms.get(roomName)?.size || 0;

                console.log(
                    chalk.magenta(
                        `[Socket:/printcart24:Customer] Joined tracking room: customerId=${userId} | orderId=${order._id} | room=${roomName} | roomMembers=${currentRoomSize} | status=SUCCESS`,
                    ),
                );

                return sendAck({
                    success: true,
                    message: 'Joined order tracking room successfully.',
                    data: {
                        orderId: order._id.toString(),
                        orderNumber: order.orderNumber,
                        currentLocation:
                            order.currentLocation && order.currentLocation.latitude !== null
                                ? {
                                      latitude: order.currentLocation.latitude,
                                      longitude: order.currentLocation.longitude,
                                      updatedAt: order.currentLocation.updatedAt,
                                  }
                                : null,
                    },
                });
            } catch (error) {
                console.log(
                    chalk.red(`[Socket:/printcart24:Customer] Exception in join:order_tracking: ${error.message}`),
                );
                return sendAck({
                    success: false,
                    code: 'INTERNAL_ERROR',
                    message: 'Internal server error joining tracking room.',
                });
            }
        });

        /**
         * Customer Leave Order Tracking Room
         * Event: leave:order_tracking
         * Payload: { orderId }
         */
        socket.on('leave:order_tracking', async (payload, callback) => {
            const sendAck = (response) => {
                if (typeof callback === 'function') {
                    callback(response);
                }
            };

            try {
                const orderId = payload?.orderId;
                if (orderId && isValidObjectId(orderId)) {
                    const roomName = `order:${orderId}`;
                    await socket.leave(roomName);
                    console.log(
                        chalk.gray(
                            `[Socket:/printcart24:Customer] Left tracking room: customerId=${userId} | orderId=${orderId} | room=${roomName}`,
                        ),
                    );
                }

                return sendAck({
                    success: true,
                    message: 'Left order tracking room.',
                });
            } catch (error) {
                console.log(
                    chalk.red(`[Socket:/printcart24:Customer] Exception in leave:order_tracking: ${error.message}`),
                );
                return sendAck({
                    success: false,
                    code: 'INTERNAL_ERROR',
                    message: 'Internal server error leaving tracking room.',
                });
            }
        });
    });
};
