/**
 * NKDV Scenario B: Pre-clipping for Independent Regional Analysis
 * 
 * This approach clips the network BEFORE computing KDE, so each region
 * gets an independent KDE calculation based only on data within that region.
 * 
 * Use this when you want to analyze different regions independently,
 * where KDE values should reflect only the local data distribution.
 */

// Parse edges_geometry.csv
function parseCsv(csvText) {
    const lines = csvText.trim().split('\n');
    const edgeCoords = {};
    for (let i = 1; i < lines.length; i++) {
        const [edgeIndex, n1_lon, n1_lat, n2_lon, n2_lat] = lines[i].split(',');
        edgeCoords[parseInt(edgeIndex)] = [
            [parseFloat(n1_lon), parseFloat(n1_lat)],
            [parseFloat(n2_lon), parseFloat(n2_lat)],
        ];
    }
    return edgeCoords;
}

// Parse NKDV output
function parseOutputText(outputText) {
    const lines = outputText.trim().split('\n');
    const numLixels = parseInt(lines[0]);
    const lixelData = [];

    for (let i = 1; i < lines.length && lixelData.length < numLixels; i++) {
        const parts = lines[i].trim().split(/\s+/);
        if (parts.length >= 4) {
            const [edgeIndex, dist_n1, dist_n2, kde_value] = parts.map(Number);
            lixelData.push([edgeIndex, dist_n1, dist_n2, kde_value]);
        }
    }
    return lixelData;
}

// Calculate lixel coordinates from edge geometry
function calculateLixelCoords(edgeCoords, edgeIndex, dist_n1, dist_n2) {
    if (!edgeCoords[edgeIndex]) {
        console.warn(`Edge ${edgeIndex} not found in geometry`);
        return [0, 0];
    }
    
    const [n1, n2] = edgeCoords[edgeIndex];
    const ratio = dist_n1 / (dist_n1 + dist_n2);
    const lon = n1[0] + ratio * (n2[0] - n1[0]);
    const lat = n1[1] + ratio * (n2[1] - n1[1]);
    return [lon, lat];
}

// Normalize KDE values
function normalizeKdeValues(values, method = 'minmax') {
    const arr = Float64Array.from(values);
    if (method === 'minmax') {
        const min = Math.min(...arr);
        const max = Math.max(...arr);
        return arr.map(v => (v - min) / (max - min + 1e-8));
    }
    return arr;
}

// Build GeoJSON from lixel data
function buildGeoJson(edgeCoords, lixelData, normMethod = 'minmax') {
    const kdeValues = lixelData.map(item => item[3]);
    const normKde = normalizeKdeValues(kdeValues, normMethod);

    const features = lixelData.map(([edgeIndex, dist_n1, dist_n2], i) => {
        const [lon, lat] = calculateLixelCoords(edgeCoords, edgeIndex, dist_n1, dist_n2);
        return {
            type: "Feature",
            geometry: {
                type: "Point",
                coordinates: [lon, lat]
            },
            properties: {
                edge_index: edgeIndex,
                dist_n1,
                dist_n2,
                density: normKde[i],
                raw_density: kdeValues[i]
            }
        };
    });

    return {
        type: "FeatureCollection",
        features
    };
}

/**
 * Scenario B: Compute NKDV with pre-clipping
 * 
 * @param {Object} bounds - Bounding box {lon_min, lon_max, lat_min, lat_max}
 * @param {Object} params - NKDV parameters
 * @returns {Promise<Object>} GeoJSON with KDE results
 */
async function computeNKDVScenarioB(bounds, params = {}) {
    console.log('=== NKDV Scenario B: Pre-clipping Analysis ===');
    console.log('Bounding box:', bounds);
    
    // Default parameters
    const {
        method = 3,
        lixel_length = 50,
        k_type = 2,
        bandwidth = 500,
        kdv_type = 1,
        t_L = 0,
        t_U = 0,
        bandwidth_t = 0
    } = params;
    
    try {
        // Step 1: Load edge geometry (only once)
        if (!window.edgeCoords) {
            console.log('Loading edge geometry...');
            const response = await fetch('edges_geometry.csv');
            const csvText = await response.text();
            window.edgeCoords = parseCsv(csvText);
            console.log(`Loaded geometry for ${Object.keys(window.edgeCoords).length} edges`);
        }
        
        // Step 2: Load network (only once)
        if (!window.networkLoaded) {
            console.log('Loading network...');
            Module.ccall('load_network', null, [], []);
            window.networkLoaded = true;
        } else {
            // Reset network to original state for new computation
            console.log('Resetting network...');
            Module.ccall('reset_network', null, [], []);
        }
        
        // Step 3: Load geometry into C++ (only once)
        if (!window.geometryLoaded) {
            console.log('Loading geometry into C++...');
            Module.ccall('load_geometry', null, ['string'], ['edges_geometry.csv']);
            window.geometryLoaded = true;
        }
        
        // Step 4: Set parameters INCLUDING bounding box
        console.log('Setting parameters with bounding box...');
        Module.ccall('load_parameters', null,
            ['number', 'number', 'number', 'number', 'number',
             'number', 'number', 'number',
             'number', 'number', 'number', 'number'],
            [method, lixel_length, k_type, bandwidth, kdv_type,
             t_L, t_U, bandwidth_t,
             bounds.lon_min, bounds.lon_max, bounds.lat_min, bounds.lat_max]
        );
        
        // Step 5: Compute (clipping happens inside compute())
        console.log('Computing NKDV with pre-clipping...');
        const startTime = performance.now();
        const outputText = Module.ccall('compute', 'string', [], []);
        const endTime = performance.now();
        console.log(`Computation completed in ${(endTime - startTime).toFixed(2)}ms`);
        
        // Step 6: Parse results
        const lixelData = parseOutputText(outputText);
        console.log(`Generated ${lixelData.length} lixels`);
        
        // Step 7: Build GeoJSON
        const geoJson = buildGeoJson(window.edgeCoords, lixelData);
        console.log(`GeoJSON created with ${geoJson.features.length} features`);
        
        return geoJson;
        
    } catch (error) {
        console.error('Error in computeNKDVScenarioB:', error);
        throw error;
    }
}

/**
 * Compare multiple regions (Scenario B use case)
 * 
 * @param {Array<Object>} regions - Array of {name, bounds}
 * @param {Object} params - NKDV parameters
 * @returns {Promise<Object>} Results for each region
 */
async function compareRegions(regions, params = {}) {
    console.log(`=== Comparing ${regions.length} regions ===`);
    
    const results = {};
    
    for (const region of regions) {
        console.log(`\nAnalyzing region: ${region.name}`);
        const geoJson = await computeNKDVScenarioB(region.bounds, params);
        
        // Calculate statistics
        const densities = geoJson.features.map(f => f.properties.raw_density);
        const stats = {
            count: densities.length,
            mean: densities.reduce((a, b) => a + b, 0) / densities.length,
            max: Math.max(...densities),
            min: Math.min(...densities)
        };
        
        results[region.name] = {
            geoJson,
            stats
        };
        
        console.log(`Region ${region.name} stats:`, stats);
    }
    
    return results;
}

// Example usage
async function exampleUsage() {
    // Example 1: Single region analysis
    const downtownBounds = {
        lon_min: -122.42,
        lon_max: -122.38,
        lat_min: 37.77,
        lat_max: 37.80
    };
    
    const result = await computeNKDVScenarioB(downtownBounds, {
        bandwidth: 500,
        lixel_length: 50
    });
    
    console.log('Downtown analysis complete:', result);
    
    // Example 2: Compare multiple regions
    const regions = [
        {
            name: 'Downtown',
            bounds: {lon_min: -122.42, lon_max: -122.38, lat_min: 37.77, lat_max: 37.80}
        },
        {
            name: 'Mission',
            bounds: {lon_min: -122.43, lon_max: -122.40, lat_min: 37.74, lat_max: 37.77}
        },
        {
            name: 'Richmond',
            bounds: {lon_min: -122.50, lon_max: -122.46, lat_min: 37.77, lat_max: 37.80}
        }
    ];
    
    const comparison = await compareRegions(regions);
    console.log('Regional comparison:', comparison);
}

// Export functions
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        computeNKDVScenarioB,
        compareRegions,
        parseCsv,
        parseOutputText,
        calculateLixelCoords,
        buildGeoJson
    };
}
