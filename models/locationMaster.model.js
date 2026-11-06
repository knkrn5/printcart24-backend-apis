import mongoose, { Schema } from 'mongoose';
import { INDIA_COUNTRY_ISO2 } from '#constants/location';

const citySchema = new Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        slug: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        latitude: {
            type: Number,
            default: 0,
        },
        longitude: {
            type: Number,
            default: 0,
        },
    },
    { _id: false },
);

const locationMasterSchema = new Schema(
    {
        countryIso2: {
            type: String,
            required: true,
            trim: true,
            uppercase: true,
            default: INDIA_COUNTRY_ISO2,
        },
        stateCode: {
            type: String,
            required: true,
            trim: true,
            uppercase: true,
        },
        stateName: {
            type: String,
            required: true,
            trim: true,
        },
        cities: {
            type: [citySchema],
            default: [],
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        seedSource: {
            type: String,
            default: '',
            trim: true,
        },
        lastSeededAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
        collection: 'location_master',
    },
);

locationMasterSchema.index({ countryIso2: 1, stateCode: 1 }, { unique: true });
locationMasterSchema.index({ countryIso2: 1, stateName: 1 });
locationMasterSchema.index({ countryIso2: 1, 'cities.slug': 1 });

const LocationMaster = mongoose.model('LocationMaster', locationMasterSchema);

export default LocationMaster;
