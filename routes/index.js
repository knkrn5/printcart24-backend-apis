// routes/index.js
import { Router } from 'express';

import authRouter from '#routes/auth';
import s3Router from '#routes/s3Credentials';
import s3PresignedRouter from '#routes/s3';
import uploadRouter from '#routes/upload';
import cmsRouter from '#routes/cmsContent';
import adminRouter from '#routes/admin';
import locationRouter from '#routes/location';
import bannerRouter from '#routes/banner';

import printServiceRouter from '#routes/printService';
import stationeryRouter from '#routes/stationery';
import printDocumentRouter from '#routes/printDocument';
import cartRouter from '#routes/cart';
import couponRouter from '#routes/coupon';
import ordersRouter from '#routes/orders';
import notificationsRouter from '#routes/notifications';
import paymentRouter from '#routes/payment';
import faqRouter from '#routes/faq';
import supportRouter from '#routes/support';

import partnerAuthRouter from '#routes/partnerAuth';
import partnerOrderRouter from '#routes/partnerOrder';
import partnerDashboardRouter from '#routes/partnerDashboard';
import partnerNotificationRouter from '#routes/partnerNotification';

const router = Router();

// Auth Routes (User)
router.use('/auth', authRouter);

// Partner Auth Routes
router.use('/partner/auth', partnerAuthRouter);
router.use('/partner/orders', partnerOrderRouter);
router.use('/partner/dashboard', partnerDashboardRouter);
router.use('/partner/notifications', partnerNotificationRouter);

// S3 Credentials (Legacy/Existing)
// router.use('/s3-credentials', s3Router);

// S3 Presigned Upload (Direct-to-S3)
router.use('/s3', s3PresignedRouter);

// S3 Upload (Backend-side)
router.use('/upload', uploadRouter);

// CMS Content (About Us, Privacy Policy, Terms & Conditions)
router.use('/cms', cmsRouter);

// Banner Content (Homepage hero, secondary cards, carousel)
router.use('/banners', bannerRouter);

// Location Master Data
router.use('/locations', locationRouter);

// Print Services Flow
router.use('/print-services', printServiceRouter);
router.use('/stationery-products', stationeryRouter);
router.use('/print-documents', printDocumentRouter);
router.use('/cart', cartRouter);
router.use('/orders', ordersRouter);

// User Notifications
router.use('/notifications', notificationsRouter);

// Coupons
router.use('/coupons', couponRouter);

// FAQs (Public)
router.use('/faqs', faqRouter);

// Help and Support
router.use('/support', supportRouter);

// Payments (Webhooks)
router.use('/payments', paymentRouter);

// Admin Routes

router.use('/admin', adminRouter);

export default router;
