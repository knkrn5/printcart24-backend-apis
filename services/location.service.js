import LocationMaster from '#models/locationMaster';
import { INDIA_COUNTRY_ISO2 } from '#constants/location';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeText = (value = '') => String(value).trim().replace(/\s+/g, ' ');

const normalizeStateCode = (value = '') => normalizeText(value).toUpperCase();

export const slugifyLocationValue = (value = '') => {
    const normalizedValue = normalizeText(value);

    return normalizedValue
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9\s-]/g, '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
};

export const normalizeIndiaStateRecords = ({ states = [], cities = [] }) => {
    const stateMap = new Map();

    for (const state of states) {
        const countryCode = normalizeStateCode(state.country_code || state.countryCode || state.country_iso2);
        if (countryCode !== INDIA_COUNTRY_ISO2) {
            continue;
        }

        const stateCode = normalizeStateCode(state.state_code || state.iso2 || state.code);
        const stateName = normalizeText(state.name || state.state_name);

        if (!stateCode || !stateName) {
            continue;
        }

        if (!stateMap.has(stateCode)) {
            stateMap.set(stateCode, {
                stateCode,
                stateName,
                cities: new Map(),
            });
        }
    }

    for (const city of cities) {
        const countryCode = normalizeStateCode(city.country_code || city.countryCode || city.country_iso2);
        if (countryCode !== INDIA_COUNTRY_ISO2) {
            continue;
        }

        const stateCode = normalizeStateCode(city.state_code || city.stateCode);
        const cityName = normalizeText(city.name || city.city_name);

        if (!stateCode || !cityName || !stateMap.has(stateCode)) {
            continue;
        }

        const citySlug = slugifyLocationValue(cityName);
        if (!citySlug) {
            continue;
        }

        const stateEntry = stateMap.get(stateCode);
        if (!stateEntry.cities.has(citySlug)) {
            stateEntry.cities.set(citySlug, {
                name: cityName,
                slug: citySlug,
                isActive: true,
            });
        }
    }

    return Array.from(stateMap.values())
        .map((state) => ({
            stateCode: state.stateCode,
            stateName: state.stateName,
            cities: Array.from(state.cities.values()).sort((left, right) =>
                left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }),
            ),
        }))
        .sort((left, right) => left.stateName.localeCompare(right.stateName, 'en', { sensitivity: 'base' }));
};

export const getActiveIndiaStates = async ({ search = '' } = {}) => {
    const filter = {
        countryIso2: INDIA_COUNTRY_ISO2,
        isActive: true,
    };

    if (search) {
        filter.stateName = { $regex: escapeRegex(search), $options: 'i' };
    }

    return await LocationMaster.find(filter).sort({ stateName: 1 }).select('stateCode stateName -_id').lean();
};

export const getActiveIndiaCitiesByStateCode = async ({ stateCode, search = '' }) => {
    const normalizedStateCode = normalizeStateCode(stateCode);

    const stateRecord = await LocationMaster.findOne({
        countryIso2: INDIA_COUNTRY_ISO2,
        stateCode: normalizedStateCode,
        isActive: true,
    })
        .select('stateCode stateName cities -_id')
        .lean();

    if (!stateRecord) {
        return null;
    }

    let filteredCities = (stateRecord.cities || []).filter((city) => city.isActive !== false);
    if (search) {
        const searchRegex = new RegExp(escapeRegex(search), 'i');
        filteredCities = filteredCities.filter((city) => searchRegex.test(city.name));
    }

    return {
        stateCode: stateRecord.stateCode,
        stateName: stateRecord.stateName,
        cities: filteredCities
            .sort((left, right) => left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }))
            .map((city) => ({
                name: city.name,
                slug: city.slug,
            })),
    };
};

export const resolveIndiaLocationSelection = async ({ stateCode, citySlug }) => {
    const normalizedStateCode = normalizeStateCode(stateCode);
    const normalizedCitySlug = slugifyLocationValue(citySlug);

    if (!normalizedStateCode || !normalizedCitySlug) {
        return null;
    }

    const stateRecord = await LocationMaster.findOne({
        countryIso2: INDIA_COUNTRY_ISO2,
        stateCode: normalizedStateCode,
        isActive: true,
    })
        .select('stateCode stateName cities -_id')
        .lean();

    if (!stateRecord) {
        return null;
    }

    const cityRecord = (stateRecord.cities || []).find(
        (city) => city.isActive !== false && city.slug === normalizedCitySlug,
    );

    if (!cityRecord) {
        return null;
    }

    return {
        stateCode: stateRecord.stateCode,
        state: stateRecord.stateName,
        citySlug: cityRecord.slug,
        city: cityRecord.name,
        latitude: Number(cityRecord.latitude || 0),
        longitude: Number(cityRecord.longitude || 0),
    };
};
