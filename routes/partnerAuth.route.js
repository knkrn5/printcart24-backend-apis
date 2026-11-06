// routes/partnerAuth.route.js
import { Router } from 'express';
import {
    getPartnerProfile,
    loginPartner,
    registerPartner,
    updatePartnerProfile,
    updatePartnerFid,
    updatePartnerFcmToken,
    togglePartnerOnlineStatus,
} from '#controllers/partnerAuth';
import { isRider, verifyPartnerToken } from '#middlewares/partnerAuth';

const partnerAuthRouter = Router();

// Public routes
partnerAuthRouter.post('/register', registerPartner);
partnerAuthRouter.post('/login', loginPartner);

// Protected Partner routes
partnerAuthRouter
    .route('/profile')
    .get(verifyPartnerToken, isRider, getPartnerProfile)
    .patch(verifyPartnerToken, isRider, updatePartnerProfile);

// Toggle Partner Online Status (Available / Offline)
partnerAuthRouter.patch('/status', verifyPartnerToken, isRider, togglePartnerOnlineStatus);

// Update Partner FCM Token
partnerAuthRouter.put('/fcm-token', verifyPartnerToken, isRider, updatePartnerFcmToken);

// Update Partner FID (Backward compatibility for Firebase Cloud Messaging Token)
partnerAuthRouter.put('/fid', verifyPartnerToken, isRider, updatePartnerFid);

export default partnerAuthRouter;
