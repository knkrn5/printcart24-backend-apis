import Joi from 'joi';
import { STATE_CODE_REGEX } from '#constants/location';

export const fetchStatesQuerySchema = Joi.object({
    search: Joi.string().trim().allow('').max(100).label('Search'),
});

export const fetchCitiesQuerySchema = Joi.object({
    stateCode: Joi.string().trim().uppercase().pattern(STATE_CODE_REGEX).required().label('State code').messages({
        'string.pattern.base': 'Invalid state code',
    }),
    search: Joi.string().trim().allow('').max(100).label('Search'),
});
