// scripts/seedIndiaLocations.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import LocationMaster from '#models/locationMaster';
import { INDIA_COUNTRY_ISO2, INDIA_LOCATION_DATASET_NAME } from '#constants/location';
import { slugifyLocationValue } from '#services/location';
import indiaStatesCities from './data/indiaStatesCities.data.js';

(async () => {
    try {
        await dbConnection();

        const normalizedStates = indiaStatesCities.map((state) => ({
            stateCode: state.stateCode,
            stateName: state.stateName,
            cities: Array.from(new Set(state.cities.map((city) => city.trim())))
                .filter(Boolean)
                .sort((left, right) => left.localeCompare(right, 'en', { sensitivity: 'base' }))
                .map((city) => ({
                    name: city,
                    slug: slugifyLocationValue(city),
                    isActive: true,
                })),
        }));
        if (!normalizedStates.length) {
            throw new Error('No India state records were prepared for seeding.');
        }

        const seededAt = new Date();
        const bulkOperations = normalizedStates.map((state) => ({
            updateOne: {
                filter: {
                    countryIso2: INDIA_COUNTRY_ISO2,
                    stateCode: state.stateCode,
                },
                update: {
                    $set: {
                        stateName: state.stateName,
                        countryIso2: INDIA_COUNTRY_ISO2,
                        isActive: true,
                        seedSource: INDIA_LOCATION_DATASET_NAME,
                        lastSeededAt: seededAt,
                    },
                    $addToSet: {
                        cities: {
                            $each: state.cities,
                        },
                    },
                },
                upsert: true,
            },
        }));

        const result = await LocationMaster.bulkWrite(bulkOperations, { ordered: false });
        const activeStateCodes = normalizedStates.map((state) => state.stateCode);
        const staleResult = await LocationMaster.deleteMany({
            countryIso2: INDIA_COUNTRY_ISO2,
            stateCode: { $nin: activeStateCodes },
        });

        const totalCities = normalizedStates.reduce((count, state) => count + state.cities.length, 0);

        console.log(
            chalk.green(`Seeded ${normalizedStates.length} Indian states/UTs and ${totalCities} mapped cities.`),
        );
        console.log(
            chalk.blue(
                `Bulk result -> inserted: ${result.insertedCount || 0}, modified: ${result.modifiedCount || 0}, upserted: ${result.upsertedCount || 0}, deleted stale states: ${staleResult.deletedCount || 0}`,
            ),
        );

        process.exit(0);
    } catch (error) {
        console.error(chalk.bgRed.white('Error during India location seeding:'), error.message, error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log(chalk.blue('MongoDB connection closed.'));
    }
})();
