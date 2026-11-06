// controllers/cmsContent.controller.js
import CmsContent from '#models/cmsContent';
import { sendResponse } from '#utils/generalHelper';
import httpStatus from 'http-status';
import redisClient from '#configs/redis';

/**
 * Create or Update CMS Content (Admin Only)
 * @route POST /api/cms
 */
export const upsertCmsContent = async (req, res) => {
    let { title, slug, content, imageUrl } = req.body;
    const adminId = req.user.id;

    if (!title || !content) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: 'Title and content are required.',
        });
    }

    // Auto-generate slug if not provided
    if (!slug || !slug.trim()) {
        slug = title
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '') // Remove special characters except spaces and dashes
            .replace(/\s+/g, '-') // Replace spaces with dashes
            .replace(/-+/g, '-'); // Remove duplicate dashes
    }

    let cmsContent = await CmsContent.findOne({ slug });

    if (cmsContent) {
        // Update existing
        cmsContent.title = title;
        cmsContent.content = content;
        cmsContent.imageUrl = imageUrl || cmsContent.imageUrl;
        cmsContent.updatedBy = adminId;
        await cmsContent.save();

        // Invalidate cache
        await redisClient.del(`cms:${slug}`);

        return sendResponse({
            res,
            statusCode: httpStatus.OK,
            data: cmsContent,
            message: 'CMS content updated successfully.',
        });
    } else {
        // Create new
        cmsContent = await CmsContent.create({
            title,
            slug,
            content,
            imageUrl: imageUrl || '',
            createdBy: adminId,
            updatedBy: adminId,
        });

        return sendResponse({
            res,
            statusCode: httpStatus.CREATED,
            data: cmsContent,
            message: 'CMS content created successfully.',
        });
    }
};

/**
 * Get CMS Content by slug (Admin & User)
 * @route GET /api/cms/:slug
 */
export const getCmsContent = async (req, res) => {
    const { slug } = req.params;

    const cacheKey = `cms:${slug}`;
    // 1. Try cache
    const cached = await redisClient.get(cacheKey);
    if (cached) {
        return sendResponse({
            res,
            statusCode: httpStatus.OK,
            data: cached,
            message: 'CMS content fetched successfully.',
        });
    }

    const cmsContent = await CmsContent.findOne({ slug }).select('-__v');

    if (!cmsContent) {
        return sendResponse({
            res,
            statusCode: httpStatus.NOT_FOUND,
            message: 'CMS content not found.',
        });
    }

    // 3. Store in Redis (TTL: 1 hour)
    await redisClient.set(cacheKey, cmsContent, 3600);

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: cmsContent,
        message: 'CMS content fetched successfully.',
    });
};

/**
 * Delete CMS Content (Admin Only)
 * @route DELETE /api/cms/:slug
 */
export const deleteCmsContent = async (req, res) => {
    const { slug } = req.params;

    const cmsContent = await CmsContent.findOneAndDelete({ slug });

    if (!cmsContent) {
        return sendResponse({
            res,
            statusCode: httpStatus.NOT_FOUND,
            message: 'CMS content not found.',
        });
    }

    // Invalidate cache
    await redisClient.del(`cms:${slug}`);

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'CMS content deleted successfully.',
    });
};
