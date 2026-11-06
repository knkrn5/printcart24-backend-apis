import httpStatus from 'http-status';
import Banner from '#models/banner';
import { isValidObjectId, sendResponse } from '#utils/generalHelper';
import { toggleBannerStatusSchema, upsertHomeBannerSchema } from '#validations/banner';
import { attachPresignedUrls, extractS3KeyFromUrl, isS3Url } from '#utils/s3Presigned';

// export const getHomeBanner = async (req, res) => {
//     const { status } = req.query;

//     const statusMap = {
//         1: true, // ACTIVE
//         2: false, // INACTIVE
//     };

//     const baseMatch = {
//         page: 'HOME',
//         isDeleted: false,
//     };

//     const statusFilter = status && statusMap[status] !== undefined ? { isActive: statusMap[status] } : {};

//     const result = await Banner.aggregate([
//         {
//             $match: baseMatch,
//         },
//         {
//             $facet: {
//                 banners: [
//                     { $match: statusFilter },
//                     {
//                         $sort: {
//                             type: 1, // PRIMARY first
//                             rank: 1,
//                             updatedAt: -1,
//                         },
//                     },
//                 ],
//                 counts: [
//                     {
//                         $group: {
//                             _id: '$isActive',
//                             count: { $sum: 1 },
//                         },
//                     },
//                 ],
//             },
//         },
//     ]);

//     const bannersRaw = result?.[0]?.banners || [];
//     const countsRaw = result?.[0]?.counts || [];

//     // ✅ Transform counts
//     const counts = {
//         active: 0,
//         inactive: 0,
//     };

//     for (const item of countsRaw) {
//         if (item._id === true) counts.active = item.count;
//         if (item._id === false) counts.inactive = item.count;
//     }

//     if (!bannersRaw.length) {
//         return sendResponse({
//             res,
//             statusCode: httpStatus.OK,
//             data: {
//                 banners: [],
//                 counts,
//             },
//             message: 'No banners configured',
//         });
//     }

//     let primaryItem = null;
//     const carouselList = [];

//     for (const item of bannersRaw) {
//         if (!item.s3Url?.trim()) continue;

//         const formatted = {
//             _id: item._id,
//             s3Url: item.s3Url,
//             redirectUrl: item.redirectUrl || null,
//             isActive: item.isActive,
//             isDeleted: item.isDeleted,
//             createdAt: item.createdAt,
//             updatedAt: item.updatedAt,
//             type: item.type,
//         };

//         if (item.type === 'PRIMARY' && !primaryItem) {
//             primaryItem = formatted;
//         } else if (item.type === 'CAROUSEL') {
//             carouselList.push(formatted);
//         }
//     }

//     const finalList = primaryItem ? [primaryItem, ...carouselList] : carouselList;

//     return sendResponse({
//         res,
//         statusCode: httpStatus.OK,
//         data: {
//             banners: finalList,
//             counts,
//         },
//         message: 'Home banner fetched successfully',
//     });
// };

export const getHomeBanner = async (req, res) => {
    const { status } = req.query;
    const userRole = req.user?.role;

    const isSuperAdmin = userRole === 'SUPER_ADMIN';

    const statusMap = {
        1: true, // ACTIVE
        2: false, // INACTIVE
    };

    const baseMatch = {
        page: 'HOME',
        isDeleted: false,
    };

    const statusFilter = status && statusMap[status] !== undefined ? { isActive: statusMap[status] } : {};

    let bannersRaw = [];
    let counts = undefined;

    // =========================
    // ✅ SUPER ADMIN → WITH COUNTS
    // =========================
    if (isSuperAdmin) {
        const result = await Banner.aggregate([
            { $match: baseMatch },
            {
                $facet: {
                    banners: [
                        { $match: statusFilter },
                        {
                            $sort: {
                                type: 1,
                                rank: 1,
                                updatedAt: -1,
                            },
                        },
                    ],
                    counts: [
                        {
                            $group: {
                                _id: '$isActive',
                                count: { $sum: 1 },
                            },
                        },
                    ],
                },
            },
        ]);

        bannersRaw = result?.[0]?.banners || [];
        const countsRaw = result?.[0]?.counts || [];

        counts = { active: 0, inactive: 0 };

        for (const item of countsRaw) {
            if (item._id === true) counts.active = item.count;
            if (item._id === false) counts.inactive = item.count;
        }
    }

    // =========================
    // ✅ NON ADMIN → NO COUNTS (ONLY ACTIVE)
    // =========================
    else {
        bannersRaw = await Banner.find({
            ...baseMatch,
            isActive: true,
        })
            .lean()
            .sort({
                type: 1,
                rank: 1,
                updatedAt: -1,
            });
    }

    // =========================
    // ✅ EMPTY CASE
    // =========================
    if (!bannersRaw.length) {
        return sendResponse({
            res,
            statusCode: httpStatus.OK,
            data: isSuperAdmin ? { banners: [], counts } : [],
            message: 'No banners configured',
        });
    }

    let primaryItem = null;
    const carouselList = [];

    for (const item of bannersRaw) {
        if (!item.s3Url?.trim()) continue;

        const formatted = {
            _id: item._id,
            s3Url: item.s3Url,
            redirectUrl: item.redirectUrl || null,
            isActive: item.isActive,
            isDeleted: item.isDeleted,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            type: item.type,
        };

        if (item.type === 'PRIMARY' && !primaryItem) {
            primaryItem = formatted;
        } else if (item.type === 'CAROUSEL') {
            carouselList.push(formatted);
        }
    }

    const finalList = primaryItem ? [primaryItem, ...carouselList] : carouselList;

    const presignedList = await attachPresignedUrls(finalList, ['s3Url'], undefined, { isPublic: true, defaultFolder: 'banners' });

    // =========================
    // ✅ FINAL RESPONSE
    // =========================
    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: isSuperAdmin ? { banners: presignedList, counts } : presignedList,
        message: 'Home banner fetched successfully',
    });
};

export const getHomeBannerById = async (req, res) => {
    const { bannerId } = req.params;

    // ✅ Validate ID
    if (!isValidObjectId(bannerId)) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: 'Invalid bannerId',
        });
    }

    // ✅ Direct lookup (no nesting anymore)
    const banner = await Banner.findOne({
        _id: bannerId,
        page: 'HOME',
        isDeleted: false,
    }).lean();

    // ❌ Not found
    if (!banner || !banner.s3Url?.trim()) {
        return sendResponse({
            res,
            statusCode: httpStatus.NOT_FOUND,
            message: 'Banner not found',
        });
    }

    // ✅ Format response (same structure as before)
    const result = {
        _id: banner._id,
        s3Url: banner.s3Url,
        redirectUrl: banner.redirectUrl || null,
        isActive: banner.isActive,
        isDeleted: banner.isDeleted,
        createdAt: banner.createdAt,
        updatedAt: banner.updatedAt,
        type: banner.type,
    };

    const presignedResult = await attachPresignedUrls(result, ['s3Url'], undefined, { isPublic: true, defaultFolder: 'banners' });

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: presignedResult,
        message: 'Banner fetched successfully',
    });
};

export const upsertHomeBanner = async (req, res) => {
    const { error, value } = upsertHomeBannerSchema.validate(req.body);

    if (error) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: error.details[0].message,
        });
    }

    const { type, bannerId, bannerItem } = value;

    // 🔒 Basic validation
    const rawS3Url = bannerItem?.s3Url?.trim();
    const s3Url = rawS3Url && (!rawS3Url.startsWith('http://') && !rawS3Url.startsWith('https://') || isS3Url(rawS3Url))
        ? (extractS3KeyFromUrl(rawS3Url) || rawS3Url)
        : rawS3Url;

    if (!bannerId && !s3Url) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: 'Carousel banner image (s3Url) is required',
        });
    }

    if (bannerId && bannerItem?.s3Url !== undefined && !s3Url) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: 'Carousel banner image cannot be empty',
        });
    }

    if (bannerId && !isValidObjectId(bannerId)) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: 'Invalid bannerId',
        });
    }

    const payload = {
        page: 'HOME',
        type,
        s3Url,
        redirectUrl: bannerItem?.redirectUrl || null,
        isActive: !!s3Url,
        updatedBy: req.user.id,
    };

    // =========================
    // ✅ CAROUSEL (CREATE / UPDATE)
    // =========================
    // 🔁 UPDATE
    if (bannerId) {
        const updated = await Banner.findOneAndUpdate(
            {
                _id: bannerId,
                type: 'CAROUSEL',
                isDeleted: false,
            },
            {
                $set: payload,
            },
            {
                returnDocument: 'after',
                runValidators: true,
            },
        );

        if (!updated) {
            return sendResponse({
                res,
                statusCode: httpStatus.NOT_FOUND,
                message: 'Carousel banner not found',
            });
        }

        return sendResponse({
            res,
            statusCode: httpStatus.OK,
            message: 'Carousel banner updated successfully',
        });
    }

    // ➕ CREATE
    await Banner.create({
        ...payload,
        createdBy: req.user.id,
        isDeleted: false,
    });

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Carousel banner added successfully',
    });
};

export const deleteHomeBannerItem = async (req, res) => {
    const { bannerId } = req.params;

    // ✅ Validate ID
    if (!bannerId || !isValidObjectId(bannerId)) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: 'Invalid bannerId',
        });
    }

    // ✅ Fetch banner directly
    const banner = await Banner.findOne({
        _id: bannerId,
        page: 'HOME',
        isDeleted: false,
    });

    if (!banner || !banner.s3Url?.trim()) {
        return sendResponse({
            res,
            statusCode: httpStatus.NOT_FOUND,
            message: 'Banner not found',
        });
    }

    // ✅ Ensure at least one carousel remains
    const remainingCount = await Banner.countDocuments({
        page: 'HOME',
        type: 'CAROUSEL',
        isDeleted: false,
        _id: { $ne: bannerId },
    });

    if (remainingCount <= 0) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: 'At least one carousel banner must exist',
        });
    }

    // ✅ Soft delete
    banner.isDeleted = true;
    banner.updatedBy = req.user.id;

    await banner.save();

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Banner deleted successfully',
    });
};

export const toggleBannerStatus = async (req, res) => {
    const { error, value } = toggleBannerStatusSchema.validate(req.params);

    if (error) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: error.details[0].message,
        });
    }

    const { bannerId } = value;

    // ✅ Validate ID
    if (!isValidObjectId(bannerId)) {
        return sendResponse({
            res,
            statusCode: httpStatus.BAD_REQUEST,
            message: 'Invalid bannerId',
        });
    }

    // ✅ Fetch banner
    const banner = await Banner.findOne({
        _id: bannerId,
        page: 'HOME',
        isDeleted: false,
    });

    if (!banner || !banner.s3Url?.trim()) {
        return sendResponse({
            res,
            statusCode: httpStatus.NOT_FOUND,
            message: 'Banner not found',
        });
    }

    // ✅ Toggle
    banner.isActive = !banner.isActive;
    banner.updatedBy = req.user.id;

    await banner.save();

    const statusLabel = banner.isActive ? 'activated' : 'deactivated';

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: `Banner ${statusLabel} successfully`,
    });
};
