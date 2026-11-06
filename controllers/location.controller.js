import httpStatus from 'http-status';
import { sendResponse } from '#utils/generalHelper';
import { fetchCitiesQuerySchema, fetchStatesQuerySchema } from '#validations/location';
import { getActiveIndiaCitiesByStateCode, getActiveIndiaStates } from '#services/location';

export const fetchStates = async (req, res) => {
    const { error, value } = fetchStatesQuerySchema.validate(req.query);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const states = await getActiveIndiaStates({ search: value.search || '' });

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: states,
        message: 'States fetched successfully',
    });
};

export const fetchCities = async (req, res) => {
    const { error, value } = fetchCitiesQuerySchema.validate(req.query);

    if (error) {
        return sendResponse({ res, statusCode: httpStatus.BAD_REQUEST, message: error.details[0].message });
    }

    const cities = await getActiveIndiaCitiesByStateCode({
        stateCode: value.stateCode,
        search: value.search || '',
    });

    if (!cities) {
        return sendResponse({ res, statusCode: httpStatus.NOT_FOUND, message: 'State not found.' });
    }

    return sendResponse({
        res,
        statusCode: httpStatus.OK,
        data: cities,
        message: 'Cities fetched successfully',
    });
};
