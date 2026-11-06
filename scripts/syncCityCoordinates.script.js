// scripts/syncCityCoordinates.script.js
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import LocationMaster from '#models/locationMaster';
import User from '#models/user';
import PrintOrder from '#models/printOrder';
import { INDIA_COUNTRY_ISO2 } from '#constants/location';
import { slugifyLocationValue } from '#services/location';

/**
 * Normalizes city name for comparison.
 */
function normalizeName(str = '') {
    return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function main() {
    try {
        console.log(chalk.blue('Connecting to database...'));
        await dbConnection();
        console.log(chalk.green('Connected to database.'));

        const citiesJsonPath = path.resolve('scripts/data/cities.json');
        if (!fs.existsSync(citiesJsonPath)) {
            throw new Error(`cities.json not found at: ${citiesJsonPath}`);
        }

        console.log(chalk.yellow('Reading scripts/data/cities.json and indexing India cities...'));
        const fileStream = fs.createReadStream(citiesJsonPath, { encoding: 'utf8' });
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

        // Map: key = `${state_code}::${slug}` -> { lat, lng }
        // Also fallback Map: key = `${state_code}::${norm}` -> { lat, lng }
        const cityCoordMap = new Map();

        let depth = 0;
        let currentBuffer = [];
        let indiaCount = 0;

        for await (const line of rl) {
            const trimmed = line.trim();
            if (depth === 0 && trimmed.startsWith('{')) {
                depth = 1;
                currentBuffer = ['{'];
                continue;
            }

            if (depth > 0) {
                currentBuffer.push(line);
                for (const ch of trimmed) {
                    if (ch === '{') depth++;
                    else if (ch === '}') depth--;
                }

                if (depth === 0) {
                    let str = currentBuffer.join('\n').trim();
                    if (str.endsWith(',')) str = str.slice(0, -1);
                    try {
                        const obj = JSON.parse(str);
                        if (obj.country_code === 'IN' || obj.country_name === 'India') {
                            indiaCount++;
                            const stateCode = String(obj.state_code || '').toUpperCase().trim();
                            const cityName = String(obj.name || '').trim();
                            const lat = parseFloat(obj.latitude) || 0;
                            const lng = parseFloat(obj.longitude) || 0;

                            if (stateCode && cityName && (lat !== 0 || lng !== 0)) {
                                const slug = slugifyLocationValue(cityName);
                                const norm = normalizeName(cityName);

                                cityCoordMap.set(`${stateCode}::${slug}`, { lat, lng, name: cityName });
                                cityCoordMap.set(`${stateCode}::${norm}`, { lat, lng, name: cityName });
                            }
                        }
                    } catch (err) {
                        // ignore malformed fragment
                    }
                    currentBuffer = [];
                }
            }
        }

        console.log(chalk.green(`Indexed ${indiaCount} India city records from cities.json.`));

        console.log(chalk.yellow('Fetching all state records from location_master collection...'));
        const stateDocs = await LocationMaster.find({ countryIso2: INDIA_COUNTRY_ISO2 });
        console.log(`Found ${stateDocs.length} states in location_master.`);

        let totalCitiesUpdated = 0;
        let totalCitiesChecked = 0;

        for (const doc of stateDocs) {
            const stateCode = doc.stateCode;
            let stateUpdated = false;

            if (Array.isArray(doc.cities)) {
                for (const city of doc.cities) {
                    totalCitiesChecked++;
                    const slug = city.slug || slugifyLocationValue(city.name);
                    const norm = normalizeName(city.name);

                    const match = cityCoordMap.get(`${stateCode}::${slug}`) || cityCoordMap.get(`${stateCode}::${norm}`);

                    if (match && (city.latitude !== match.lat || city.longitude !== match.lng)) {
                        city.latitude = match.lat;
                        city.longitude = match.lng;
                        stateUpdated = true;
                        totalCitiesUpdated++;
                    }
                }
            }

            if (stateUpdated) {
                doc.markModified('cities');
                await doc.save();
                console.log(chalk.cyan(`Updated coordinates for state: ${doc.stateName} (${stateCode})`));
            }
        }

        console.log(chalk.bold.green('\nSuccessfully synchronized city coordinates!'));
        console.log(`Total cities inspected: ${totalCitiesChecked}`);
        console.log(`Total cities with coordinates updated: ${totalCitiesUpdated}`);

        // Backfill existing user addresses
        console.log(chalk.yellow('\nBackfilling coordinates for existing user addresses...'));
        const users = await User.find({ 'addresses.0': { $exists: true } });
        let userAddressesUpdated = 0;

        for (const user of users) {
            let modified = false;
            for (const addr of user.addresses) {
                if (!addr.latitude || !addr.longitude || addr.latitude === 0 || addr.longitude === 0) {
                    const stateCode = addr.stateCode || '';
                    const slug = addr.citySlug || slugifyLocationValue(addr.city);
                    const norm = normalizeName(addr.city);

                    const match = cityCoordMap.get(`${stateCode}::${slug}`) || cityCoordMap.get(`${stateCode}::${norm}`);
                    if (match) {
                        addr.latitude = match.lat;
                        addr.longitude = match.lng;
                        modified = true;
                        userAddressesUpdated++;
                    } else if (addr.latitude === undefined || addr.longitude === undefined) {
                        addr.latitude = 0;
                        addr.longitude = 0;
                        modified = true;
                    }
                }
            }
            if (modified) {
                user.markModified('addresses');
                await user.save();
            }
        }
        console.log(chalk.green(`Updated ${userAddressesUpdated} user addresses with coordinates.`));

        // Backfill existing orders
        console.log(chalk.yellow('\nBackfilling coordinates for existing orders...'));
        const orders = await PrintOrder.find({
            $or: [
                { 'deliveryAddress.latitude': { $exists: false } },
                { 'deliveryAddress.latitude': 0 },
            ],
            'deliveryAddress.city': { $exists: true, $ne: '' },
        });
        let ordersUpdated = 0;

        for (const order of orders) {
            const addr = order.deliveryAddress;
            const stateCode = addr.stateCode || '';
            const slug = addr.citySlug || slugifyLocationValue(addr.city);
            const norm = normalizeName(addr.city);

            const match = cityCoordMap.get(`${stateCode}::${slug}`) || cityCoordMap.get(`${stateCode}::${norm}`);
            if (match) {
                order.deliveryAddress.latitude = match.lat;
                order.deliveryAddress.longitude = match.lng;
                order.markModified('deliveryAddress');
                await order.save();
                ordersUpdated++;
            }
        }
        console.log(chalk.green(`Updated ${ordersUpdated} existing orders with coordinates.`));

        // Sample verification
        const sampleDelhi = await LocationMaster.findOne({ stateCode: 'DL' }).lean();
        const sampleNoida = await LocationMaster.findOne({ stateCode: 'UP' }).lean();

        console.log('\nSample Delhi cities:');
        console.table((sampleDelhi?.cities || []).slice(0, 5).map(c => ({ name: c.name, slug: c.slug, lat: c.latitude, lng: c.longitude })));

        console.log('\nSample UP cities:');
        console.table((sampleNoida?.cities || []).filter(c => c.slug?.includes('noida') || c.slug?.includes('lucknow')).map(c => ({ name: c.name, slug: c.slug, lat: c.latitude, lng: c.longitude })));

        await mongoose.disconnect();
        console.log('Database disconnected.');
        process.exit(0);
    } catch (error) {
        console.error(chalk.red('Sync failed:'), error);
        process.exit(1);
    }
}

main();