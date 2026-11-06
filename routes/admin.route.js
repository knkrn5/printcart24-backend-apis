// routes/admin.route.js
import {
    adminLogin,
    adminLogout,
    changeAdminPassword,
    getAdminProfile,
    updateAdminProfile,
    adminGetDashboardStats,
} from '#controllers/admin';
import {
    adminSendNotification,
    adminGetNotifications,
    adminGetNotificationById,
    adminDeleteNotification,
} from '#controllers/notification';
import {
    adminListPrintServices,
    adminGetPrintServiceCustomizations,
    adminUpdatePrintServiceCombinationPricing,
    adminGetSharedBindingTogglePricing,
    adminUpdateSharedBindingTogglePricing,
    getAdminPrintServicePricing,
    upsertAdminPrintServicePricing,
} from '#controllers/printServicePricing';
import {
    adminDeleteStationeryProduct,
    adminGetStationeryProduct,
    adminListStationeryProducts,
    adminUpsertStationeryProduct,
    adminUpdateStationeryProductStatus,
} from '#controllers/stationery';
import {
    adminListOrders,
    adminGetOrderById,
    adminUpdateOrderStatus,
} from '#controllers/orders';
import {
    adminCreateCoupon,
    adminUpdateCoupon,
    adminListCoupons,
    adminGetCouponById,
    adminDeleteCoupon,
    adminUpdateCouponStatus,
} from '#controllers/coupon';
import { adminListUsers, adminGetUserById, adminUpdateUserStatus, adminSoftDeleteUser } from '#controllers/users';
import { adminListPartners, adminGetPartnerById, adminUpdatePartnerStatus, adminAssignOrderPartner } from '#controllers/partnerAdmin';
import {
    adminCreateFaq,
    adminUpdateFaq,
    adminListFaqs,
    adminGetFaqById,
    adminDeleteFaq,
    adminUpdateFaqStatus,
} from '#controllers/faq';
import { adminGetPricingSettings, adminUpdatePricingSettings } from '#controllers/pricingSetting';
import { verifyAdminToken } from '#middlewares/auth';
import asyncHandler from '#utils/asyncHandler';
import { Router } from 'express';

const adminRouter = Router();

/**
 * @route POST /api/admin/login
 * @desc Admin Login
 */
adminRouter.post('/login', asyncHandler(adminLogin));

/**
 * @route POST /api/admin/logout
 * @desc Admin Logout
 */
adminRouter.post('/logout', verifyAdminToken, asyncHandler(adminLogout));

/**
 * @route POST /api/admin/change-password
 * @desc Change Admin Password
 */
adminRouter.post('/change-password', verifyAdminToken, asyncHandler(changeAdminPassword));

/**
 * @route GET  /api/admin/profile
 * @route PATCH /api/admin/profile
 * @desc Get / Update Own Admin Profile
 */
adminRouter
    .route('/profile')
    .get(verifyAdminToken, asyncHandler(getAdminProfile))
    .patch(verifyAdminToken, asyncHandler(updateAdminProfile));

/**
 * @route GET /api/admin/dashboard/stats
 * @desc Dashboard – total/active/inactive users + total/completed/cancelled orders
 */
adminRouter.route('/dashboard/stats').get(verifyAdminToken, asyncHandler(adminGetDashboardStats));

/**
 * @route GET /api/admin/print-services   – List active print services (for pricing management)
 */
adminRouter.route('/print-services').get(verifyAdminToken, asyncHandler(adminListPrintServices));

/**
 * @route GET /api/admin/print-services/binding-toggles   – List shared binding toggle pricing
 * @route PUT /api/admin/print-services/binding-toggles   – Update shared binding toggle pricing
 * @desc  Binding toggle prices must be identical across Document Printing, Thesis Printing,
 *        and Thesis Binding (business rule) — updates propagate to all 3 services' own
 *        PrintService documents (each keeps an independent copy, kept in sync on write).
 */
adminRouter
    .route('/print-services/binding-toggles')
    .get(verifyAdminToken, asyncHandler(adminGetSharedBindingTogglePricing))
    .put(verifyAdminToken, asyncHandler(adminUpdateSharedBindingTogglePricing));

/**
 * @route GET /api/admin/print-services/:serviceId/customizations   – List active customizations/options for a service
 */
adminRouter
    .route('/print-services/:serviceId/customizations')
    .get(verifyAdminToken, asyncHandler(adminGetPrintServiceCustomizations));

/**
 * @route PUT /api/admin/print-services/:serviceId/pricing/combinations   – Update combination pricing (Document Printing only, for now)
 */
adminRouter
    .route('/print-services/:serviceId/pricing/combinations')
    .put(verifyAdminToken, asyncHandler(adminUpdatePrintServiceCombinationPricing));

/**
 * @route GET    /api/admin/print-services/:serviceId/pricing   – Get single print service pricing
 * @route PUT    /api/admin/print-services/:serviceId/pricing   – Update print service pricing
 */
adminRouter
    .route('/print-services/:serviceId/pricing')
    .get(verifyAdminToken, asyncHandler(getAdminPrintServicePricing))
    .put(verifyAdminToken, asyncHandler(upsertAdminPrintServicePricing));

/**
 * @route GET    /api/admin/stationery-products                   - List all (filterable + paginated)
 * @route PUT    /api/admin/stationery-products                   - Create or update new stationery product
 * @route GET    /api/admin/stationery-products/:productId   - Get single stationery product
 * @route DELETE /api/admin/stationery-products/:productId   - Soft-delete stationery product
 * @route PATCH  /api/admin/stationery-products/:productId/status - Toggle active status
 */
adminRouter
    .route('/stationery-products')
    .get(verifyAdminToken, asyncHandler(adminListStationeryProducts))
    .put(verifyAdminToken, asyncHandler(adminUpsertStationeryProduct));

adminRouter
    .route('/stationery-products/:productId')
    .get(verifyAdminToken, asyncHandler(adminGetStationeryProduct))
    .delete(verifyAdminToken, asyncHandler(adminDeleteStationeryProduct));

adminRouter
    .route('/stationery-products/:productId/status')
    .patch(verifyAdminToken, asyncHandler(adminUpdateStationeryProductStatus));

/**
 * @route GET   /api/admin/orders          – List all orders (filterable, with status counts)
 * @route GET   /api/admin/orders/status-counts – Standalone status counts for dashboard
 * @route GET   /api/admin/orders/:orderId – Get order detail
 * @route PATCH /api/admin/orders/:orderId/status – Update order status
 * @route PATCH /api/admin/orders/:orderId/assign-partner – Assign partner to order
 */
adminRouter.route('/orders').get(verifyAdminToken, asyncHandler(adminListOrders));

adminRouter.route('/orders/:orderId').get(verifyAdminToken, asyncHandler(adminGetOrderById));

adminRouter.route('/orders/:orderId/status').patch(verifyAdminToken, asyncHandler(adminUpdateOrderStatus));

adminRouter.route('/orders/:orderId/assign-partner').patch(verifyAdminToken, asyncHandler(adminAssignOrderPartner));

/**
 * @route GET    /api/admin/users                    – List users (paginated + filters: isActive, search)
 * @route GET    /api/admin/users/counts             – User counts: total, active, inactive, deleted
 * @route GET    /api/admin/users/:userId            – Get single user detail
 * @route PATCH  /api/admin/users/:userId/status     – Activate / Deactivate user
 * @route DELETE /api/admin/users/:userId            – Soft-delete user
 */
adminRouter.route('/users').get(verifyAdminToken, asyncHandler(adminListUsers));

adminRouter
    .route('/users/:userId')
    .get(verifyAdminToken, asyncHandler(adminGetUserById))
    .delete(verifyAdminToken, asyncHandler(adminSoftDeleteUser));

adminRouter.route('/users/:userId/status').patch(verifyAdminToken, asyncHandler(adminUpdateUserStatus));

/**
 * ─── Notifications ─────────────────────────────────────────────────────────
 * @route GET    /api/admin/notifications                   – List all (filterable + paginated)
 * @route POST   /api/admin/notifications                   – Send / create notification
 * @route GET    /api/admin/notifications/:notificationId   – Get single detail
 * @route DELETE /api/admin/notifications/:notificationId   – Soft-delete
 */
adminRouter
    .route('/notifications')
    .get(verifyAdminToken, asyncHandler(adminGetNotifications))
    .post(verifyAdminToken, asyncHandler(adminSendNotification));

adminRouter
    .route('/notifications/:notificationId')
    .get(verifyAdminToken, asyncHandler(adminGetNotificationById))
    .delete(verifyAdminToken, asyncHandler(adminDeleteNotification));

/**
 * ─── Coupons ─────────────────────────────────────────────────────────────
 * @route GET    /api/admin/coupons
 * @route POST   /api/admin/coupons
 * @route GET    /api/admin/coupons/:couponId
 * @route PUT    /api/admin/coupons/:couponId
 * @route DELETE /api/admin/coupons/:couponId
 */
adminRouter
    .route('/coupons')
    .post(verifyAdminToken, asyncHandler(adminCreateCoupon))
    .get(verifyAdminToken, asyncHandler(adminListCoupons));

adminRouter
    .route('/coupons/:couponId')
    .get(verifyAdminToken, asyncHandler(adminGetCouponById))
    .put(verifyAdminToken, asyncHandler(adminUpdateCoupon))
    .delete(verifyAdminToken, asyncHandler(adminDeleteCoupon));

adminRouter
    .route('/coupons/:couponId/status')
    .patch(verifyAdminToken, asyncHandler(adminUpdateCouponStatus));

/**
 * ─── FAQs ───────────────────────────────────────────────────────────────────
 * @route GET    /api/admin/faqs
 * @route POST   /api/admin/faqs
 * @route GET    /api/admin/faqs/:faqId
 * @route PUT    /api/admin/faqs/:faqId
 * @route DELETE /api/admin/faqs/:faqId
 * @route PATCH  /api/admin/faqs/:faqId/status
 */
adminRouter
    .route('/faqs')
    .get(verifyAdminToken, asyncHandler(adminListFaqs))
    .post(verifyAdminToken, asyncHandler(adminCreateFaq));

adminRouter
    .route('/faqs/:faqId')
    .get(verifyAdminToken, asyncHandler(adminGetFaqById))
    .put(verifyAdminToken, asyncHandler(adminUpdateFaq))
    .delete(verifyAdminToken, asyncHandler(adminDeleteFaq));

adminRouter
    .route('/faqs/:faqId/status')
    .patch(verifyAdminToken, asyncHandler(adminUpdateFaqStatus));

/**
 * ─── Partners / Riders ───────────────────────────────────────────────────────
 * @route GET   /api/admin/partners                 – List riders (paginated + filters)
 * @route GET   /api/admin/partners/:partnerId       – Get rider detail
 * @route PATCH /api/admin/partners/:partnerId/status – Update rider account status (e.g. PENDING -> ACTIVE)
 */
adminRouter.route('/partners').get(verifyAdminToken, asyncHandler(adminListPartners));
adminRouter.route('/partners/:partnerId').get(verifyAdminToken, asyncHandler(adminGetPartnerById));
adminRouter.route('/partners/:partnerId/status').patch(verifyAdminToken, asyncHandler(adminUpdatePartnerStatus));

/**
 * ─── Pricing Settings ──────────────────────────────────────────────────────────
 * @route GET /api/admin/pricing-settings – Get global pricing settings
 * @route PUT /api/admin/pricing-settings – Update global pricing settings
 */
adminRouter
    .route('/pricing-settings')
    .get(verifyAdminToken, asyncHandler(adminGetPricingSettings))
    .put(verifyAdminToken, asyncHandler(adminUpdatePricingSettings));

export default adminRouter;
