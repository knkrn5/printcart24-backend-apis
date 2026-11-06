// constants/mockTracking.constants.js

/**
 * Temporary fallback coordinates for order tracking.
 * Used for UI map rendering / route plotting until live telemetry is provided.
 *
 * Current Location: B-25, Sector-2, Noida, Uttar Pradesh
 * Destination: Sadar Bazar, New Delhi, Delhi
 */
export const MOCK_TRACKING_COORDINATES = {
    currentLocation: {
        latitude: 28.5878,
        longitude: 77.3129,
        address: 'B-25, Sector-2, Noida, Uttar Pradesh 201301',
    },
    destination: {
        latitude: 28.6562,
        longitude: 77.2144,
        address: 'Main Market, Sadar Bazar, New Delhi, Delhi 110006',
    },
};
