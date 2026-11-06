import { Router } from 'express';
import asyncHandler from '#utils/asyncHandler';
import { listActiveFaqs } from '#controllers/faq';

const faqRouter = Router();

/**
 * @description Get all active FAQs (public)
 * @route GET /api/faqs
 */
faqRouter.route('/').get(asyncHandler(listActiveFaqs));

export default faqRouter;
