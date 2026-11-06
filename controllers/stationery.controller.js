import httpStatus from 'http-status';
import StationeryProduct from '#models/stationeryProduct';
import Cart from '#models/cart';
import { sendResponse } from '#utils/generalHelper';
import { attachPresignedUrls, extractS3KeyFromUrl } from '#utils/s3Presigned';
import {
    adminListStationeryProductsQuerySchema,
    adminStationeryProductParamsSchema,
    upsertStationeryProductSchema,
    getStationeryProductParamsSchema,
    listStationeryProductsQuerySchema,
} from '#validations/stationery';

const BG_COLORS = ['#FFE8AE', '#F5FFB1', '#AEFFF2', '#B1DDFF', '#D4FFAE', '#FFC1C1'];

const roundCurrency = (amount = 0) => Number((Number(amount) || 0).toFixed(2));
const formatCurrency = (amount = 0) => roundCurrency(amount);

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


const buildSort = (sortBy, sortOrder) => {
    const direction = sortOrder === 'desc' ? -1 : 1;

    if (sortBy === 'itemPrice') {
        return { itemPrice: direction, _id: -1 };
    }

    return { [sortBy]: direction, _id: -1 };
};

const buildSearchFilter = (search = '') => {
    if (!search?.trim()) return null;

    const escapedSearch = escapeRegExp(search.trim());

    return {
        $or: [
            { name: { $regex: escapedSearch, $options: 'i' } },
            { brand: { $regex: escapedSearch, $options: 'i' } },
            { description: { $regex: escapedSearch, $options: 'i' } },
        ],
    };
};

const buildPriceFilter = (minPrice, maxPrice) => {
    const range = {};

    if (minPrice !== undefined) range.$gte = minPrice;
    if (maxPrice !== undefined) range.$lte = maxPrice;

    if (!Object.keys(range).length) return null;

    return {
        itemPrice: range,
    };
};

const buildListingItem = (product = {}, cartMap = new Map()) => {
    const cartItem = cartMap.get(product._id.toString());

    return {
        _id: product._id,
        name: product.name,
        brand: product.brand || '',
        shortDescription: product.description || '',
        thumbnailUrl: product.thumbnailUrl || '',
        bgColor: product.bgColor || '',
        itemPrice: formatCurrency(product.itemPrice || 0),
        stock: product.stock || 0,
        cartItem: cartItem ? { _id: cartItem._id, quantity: cartItem.quantity } : null,
    };
};

const buildDetailPayload = (product = {}, cartMap = new Map()) => {
    const cartItem = cartMap.get(product._id.toString());

    return {
        _id: product._id,
        name: product.name,
        brand: product.brand || '',
        description: product.description || '',
        thumbnailUrl: product.thumbnailUrl || '',
        bgColor: product.bgColor || '',
        itemPrice: formatCurrency(product.itemPrice || 0),
        stock: product.stock || 0,
        cartItem: cartItem ? { _id: cartItem._id, quantity: cartItem.quantity } : null,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
    };
};

export const listStationeryProducts = async (req, res) => {
    const { error, value } = listStationeryProductsQuerySchema.validate(req.query);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const filter = {
        isActive: true,
        ...(value.brand ? { brand: value.brand } : {}),
    };

    const searchFilter = buildSearchFilter(value.search);
    const priceFilter = buildPriceFilter(value.minPrice, value.maxPrice);

    if (searchFilter) Object.assign(filter, searchFilter);
    if (priceFilter) Object.assign(filter, priceFilter);

    const page = Number(value.page);
    const limit = Number(value.limit);
    const skip = (page - 1) * limit;

    const [products, count, cart] = await Promise.all([
        StationeryProduct.find(filter)
            .sort(buildSort(value.sortBy, value.sortOrder))
            .skip(skip)
            .limit(limit)
            .select('-__v')
            .lean(),
        StationeryProduct.countDocuments(filter),
        Cart.findOne({ user: req.user.id, status: 'ACTIVE' }).select('stationeryItems').lean(),
    ]);

    const cartMap = new Map(
        (cart?.stationeryItems || []).map((item) => [item.stationery?.toString() || '', item]),
    );

    const listingItems = products.map((p) => buildListingItem(p, cartMap));
    const presignedListingItems = await attachPresignedUrls(listingItems, ['thumbnailUrl'], undefined, { isPublic: true, defaultFolder: 'stationery' });

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Stationery products fetched successfully',
        data: presignedListingItems,
        count,
    });
};

export const getStationeryProduct = async (req, res) => {
    const { error, value } = getStationeryProductParamsSchema.validate(req.params);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const [product, cart] = await Promise.all([
        StationeryProduct.findOne({ _id: value.productId, isActive: true }).select('-__v').lean(),
        Cart.findOne({ user: req.user.id, status: 'ACTIVE' }).select('stationeryItems').lean(),
    ]);

    if (!product) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Stationery product not found' });
    }

    const cartMap = new Map(
        (cart?.stationeryItems || []).map((item) => [item.stationery?.toString() || '', item]),
    );

    const detailPayload = buildDetailPayload(product, cartMap);
    const presignedDetail = await attachPresignedUrls(detailPayload, ['thumbnailUrl'], undefined, { isPublic: true, defaultFolder: 'stationery' });

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Stationery product fetched successfully',
        data: presignedDetail,
    });
};

export const adminListStationeryProducts = async (req, res) => {
    const { error, value } = adminListStationeryProductsQuerySchema.validate(req.query);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const filter = {};

    if (value.status === 1) filter.isActive = true;
    if (value.status === 2) filter.isActive = false;

    const searchFilter = buildSearchFilter(value.search);
    if (searchFilter) Object.assign(filter, searchFilter);

    const page = Number(value.page);
    const limit = Number(value.limit);
    const skip = (page - 1) * limit;

    const [products, count, totalProducts, activeProducts, inactiveProducts] = await Promise.all([
        StationeryProduct.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .select('-__v -bgColor')
            .lean(),
        StationeryProduct.countDocuments(filter),
        StationeryProduct.countDocuments({}),
        StationeryProduct.countDocuments({ isActive: true }),
        StationeryProduct.countDocuments({ isActive: false }),
    ]);

    const presignedProducts = await attachPresignedUrls(products, ['thumbnailUrl'], undefined, { isPublic: true, defaultFolder: 'stationery' });

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Stationery products fetched successfully',
        data: {
            products: presignedProducts,
            productCounts: { total: totalProducts, active: activeProducts, inactive: inactiveProducts },
            count,
        },
    });
};

export const adminGetStationeryProduct = async (req, res) => {
    const { error, value } = adminStationeryProductParamsSchema.validate(req.params);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const product = await StationeryProduct.findById(value.productId).select('-__v -bgColor').lean();

    if (!product) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Stationery product not found' });
    }

    const presignedProduct = await attachPresignedUrls(product, ['thumbnailUrl'], undefined, { isPublic: true, defaultFolder: 'stationery' });

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Stationery product fetched successfully',
        data: presignedProduct,
    });
};

// escapeRegExp moved to top level for global use


export const adminUpsertStationeryProduct = async (req, res) => {
    const { error, value } = upsertStationeryProductSchema.validate(req.body);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const { productId, ...productData } = value;

    if (productData.thumbnailUrl) {
        productData.thumbnailUrl = extractS3KeyFromUrl(productData.thumbnailUrl) || productData.thumbnailUrl;
    }

    // ============================================
    // UPDATE EXISTING (PATCH LOGIC)
    // ============================================
    if (productId) {
        if (productData.name !== undefined || productData.brand !== undefined) {
            const productToUpdate = await StationeryProduct.findById(productId).select('name brand').lean();

            if (!productToUpdate) {
                return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Stationery product not found' });
            }

            const checkName = productData.name !== undefined ? productData.name : productToUpdate.name;
            const checkBrand = productData.brand !== undefined ? productData.brand : productToUpdate.brand;

            const nameBrandExists = await StationeryProduct.findOne({
                _id: { $ne: productId },
                name: { $regex: new RegExp(`^${escapeRegExp(checkName)}$`, 'i') },
                brand: { $regex: new RegExp(`^${escapeRegExp(checkBrand || '')}$`, 'i') },
            }).select('_id').lean();

            if (nameBrandExists) {
                return sendResponse({ res, statusCode: httpStatus.CONFLICT, message: 'A stationery product with this name and brand already exists.' });
            }
        }

        const product = await StationeryProduct.findByIdAndUpdate(
            productId,
            { $set: productData },
            { returnDocument: 'after' },
        ).select('-__v -bgColor');

        if (!product) {
            return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Stationery product not found' });
        }

        const presignedProduct = await attachPresignedUrls(product, ['thumbnailUrl'], undefined, { isPublic: true, defaultFolder: 'stationery' });

        return sendResponse({
            res,
            statusCode: httpStatus.OK,
            message: 'Stationery product updated successfully',
            data: presignedProduct,
        });
    }

    // ============================================
    // CREATE NEW (POST LOGIC)
    // ============================================
    const existingProduct = await StationeryProduct.findOne({
        name: { $regex: new RegExp(`^${escapeRegExp(productData.name)}$`, 'i') },
        brand: { $regex: new RegExp(`^${escapeRegExp(productData.brand || '')}$`, 'i') },
    }).select('_id').lean();

    if (existingProduct) {
        return sendResponse({ res, statusCode: httpStatus.CONFLICT, message: 'A stationery product with this name and brand already exists.' });
    }

    const lastProduct = await StationeryProduct.findOne().sort({ _id: -1 }).select('bgColor').lean();
    let nextBgColor = BG_COLORS[0];
    if (lastProduct && lastProduct.bgColor) {
        const lastIndex = BG_COLORS.indexOf(lastProduct.bgColor);
        if (lastIndex !== -1) {
            nextBgColor = BG_COLORS[(lastIndex + 1) % BG_COLORS.length];
        }
    }
    productData.bgColor = nextBgColor;

    const product = await StationeryProduct.create(productData);
    const productObj = product.toObject();
    delete productObj.bgColor;
    delete productObj.__v;

    const presignedProduct = await attachPresignedUrls(productObj, ['thumbnailUrl'], undefined, { isPublic: true, defaultFolder: 'stationery' });

    return sendResponse({
        res,
        statusCode: httpStatus.CREATED,
        message: 'Stationery product created successfully',
        data: presignedProduct,
    });
};

export const adminDeleteStationeryProduct = async (req, res) => {
    const { error, value } = adminStationeryProductParamsSchema.validate(req.params);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const product = await StationeryProduct.findByIdAndDelete(value.productId).select('-__v');

    if (!product) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Stationery product not found' });
    }

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: 'Stationery product deleted successfully',
    });
};

export const adminUpdateStationeryProductStatus = async (req, res) => {
    const { error, value } = adminStationeryProductParamsSchema.validate(req.params);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const existing = await StationeryProduct.findById(value.productId).select('isActive');

    if (!existing) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'Stationery product not found' });
    }

    const newStatus = !existing.isActive;

    const product = await StationeryProduct.findByIdAndUpdate(
        value.productId,
        { $set: { isActive: newStatus } },
        { returnDocument: 'after' },
    ).select('_id isActive updatedAt');

    const statusLabel = newStatus ? 'activated' : 'deactivated';

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        message: `Stationery product ${statusLabel} successfully`,
        data: { _id: product._id, isActive: product.isActive, updatedAt: product.updatedAt },
    });
};
