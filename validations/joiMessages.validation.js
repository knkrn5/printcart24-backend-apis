// validations/joiMessages.validation.js

const joiMessages = {
    // General
    'any.required': '{{#label}} is required',
    'any.only': '{{#label}} must be one of {{#valids}}',

    // String
    'string.base': '{{#label}} must be a string',
    'string.empty': '{{#label}} cannot be empty',
    'string.min': '{{#label}} should have at least {{#limit}} characters',
    'string.max': '{{#label}} should not exceed {{#limit}} characters',
    'string.length': '{{#label}} must be {{#limit}} characters long',
    'string.pattern.base': '{{#label}} format is invalid',
    'string.email': 'Please enter a valid email address',

    // Number
    'number.base': '{{#label}} must be a number',
    'number.min': '{{#label}} must be greater than or equal to {{#limit}}',
    'number.max': '{{#label}} must be less than or equal to {{#limit}}',
    'number.integer': '{{#label}} must be an integer',

    // Boolean
    'boolean.base': '{{#label}} must be true or false',

    // Array
    'array.base': '{{#label}} must be an array',
    'array.min': '{{#label}} must contain at least {{#limit}} items',
    'array.max': '{{#label}} must contain less than or equal to {{#limit}} items',

    // Object
    'object.base': '{{#label}} must be an object',
    'object.unknown': '{{#label}} is not allowed',

    // Date
    'date.base': '{{#label}} must be a valid date',
    'date.greater': '{{#label}} must be greater than {{#limit}}',
    'date.less': '{{#label}} must be less than {{#limit}}',

    // Alternatives
    'alternatives.match': '{{#label}} does not match any of the allowed types',

    // Custom (optional)
    'any.invalid': '{{#label}} is invalid',
};

export const validate = (schema, payload) => {
    return schema.validate(payload, {
        abortEarly: false,
        allowUnknown: true,
        messages: joiMessages,
    });
};
