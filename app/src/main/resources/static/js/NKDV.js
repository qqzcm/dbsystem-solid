let nkdvModule = null;
let edgeCoords = null;
let updateTimeout = null;
let isMapReady = false;

let timeCache = new Map();
let fullLixelData = null;
let currentParams = null;
let globalKDEMin = null;
let globalKDEMax = null;
let allTimeGeoJson = null;
let isPrecomputing = false;
let currentNetworkType = 1;

async function initModule() {
    if (!nkdvModule) {
        if (typeof NKDVModule === 'undefined') {
            await new Promise((resolve) => {
                const checkModule = setInterval(() => {
                    if (typeof NKDVModule !== 'undefined') {
                        clearInterval(checkModule);
                        resolve();
                    }
                }, 50);
            });
        }
        
        nkdvModule = await NKDVModule({
            locateFile: (path, prefix) => {
                if (path.endsWith('.data')) {
                    return '/js/nkdvWasm/nkdvCpp.data';
                }
                return prefix + path;
            }
        });
        
        nkdvModule._load_network();
        currentNetworkType = 1;
    }
    return nkdvModule;
}

async function ensureCorrectNetwork(vueThis) {
    const module = await initModule();
    const targetType = vueThis.NKDV.nkdv_type;
    
    if (currentNetworkType !== targetType) {
        module._reset_network();
        
        if (targetType == 3) {
            if (module._load_spatiotemporal_network) {
                module._load_spatiotemporal_network();
            } else {
                console.warn('[NKDV] _load_spatiotemporal_network not available, using regular network');
                module._load_network();
            }
            currentNetworkType = 3;
        } else {
            module._load_network();
            currentNetworkType = 1;
        }
        
        clearCache();
    }
}

async function loadEdgeGeometry() {
    if (!edgeCoords) {
        const response = await fetch('/data/NKDV/edges_geometry.csv');
        if (!response.ok) throw new Error('Failed to load edge geometry');
        const text = await response.text();
        edgeCoords = parseCsv(text);
    }
    return edgeCoords;
}

function getBounds(vueThis) {
    let bounds = vueThis.map.getBounds();
    if (bounds) {
        let sw = bounds.getSouthWest();
        let ne = bounds.getNorthEast();
        vueThis.NKDV.lon_min = sw.lng;
        vueThis.NKDV.lon_max = ne.lng;
        vueThis.NKDV.lat_min = sw.lat;
        vueThis.NKDV.lat_max = ne.lat;
    }
}

function filterByBounds(lixelData, edgeCoords, bounds, kdv_type = 1) {
    if (kdv_type == 3) {
        return lixelData.filter(([edgeIndex, dist_n1, dist_n2, time, kde_value]) => {
            const [lon, lat] = calculateLixelCoords(edgeCoords, edgeIndex, dist_n1, dist_n2);
            return lon >= bounds.lon_min && lon <= bounds.lon_max &&
                   lat >= bounds.lat_min && lat <= bounds.lat_max;
        });
    } else {
        return lixelData.filter(([edgeIndex, dist_n1, dist_n2, kde_value]) => {
            const [lon, lat] = calculateLixelCoords(edgeCoords, edgeIndex, dist_n1, dist_n2);
            return lon >= bounds.lon_min && lon <= bounds.lon_max &&
                   lat >= bounds.lat_min && lat <= bounds.lat_max;
        });
    }
}

function paramsChanged(vueThis) {
    let newParams = `${vueThis.NKDV.lixel}_${vueThis.NKDV.bandwidth}_${vueThis.NKDV.nkdv_type}_${vueThis.NKDV.bandwidth_t}`;
    if (currentParams !== newParams) {
        currentParams = newParams;
        return true;
    }
    return false;
}

function getTimeCacheKey(cur_t) {
    return Math.round(cur_t * 100) / 100;
}

function clearCache() {
    fullLixelData = null;
    timeCache.clear();
    allTimeGeoJson = null;
}

async function compute_nkdv_with_bounds(vueThis) {
    const module = await initModule();
    const coords = await loadEdgeGeometry();
    getBounds(vueThis);
    
    if (paramsChanged(vueThis)) {
        clearCache();
    }
    
    await ensureCorrectNetwork(vueThis);
    
    if (vueThis.NKDV.nkdv_type == 3) {
        const timeKey = getTimeCacheKey(vueThis.NKDV.cur_t);
        const cached = timeCache.get(timeKey);
        
        if (cached && cached.params === currentParams) {
            fullLixelData = cached.data;
        } else {
            module._load_parameters(
                3, vueThis.NKDV.lixel, 2, vueThis.NKDV.bandwidth,
                vueThis.NKDV.nkdv_type, vueThis.NKDV.t_L, vueThis.NKDV.t_U,
                vueThis.NKDV.bandwidth_t, vueThis.NKDV.cur_t,
                vueThis.NKDV.lon_min, vueThis.NKDV.lon_max,
                vueThis.NKDV.lat_min, vueThis.NKDV.lat_max
            );
            
            const resultPtr = module._compute();
            let data;
            if (resultPtr === null || resultPtr === undefined) {
                throw new Error('_compute() returned null or undefined');
            } else if (typeof resultPtr === 'string') {
                data = resultPtr;
            } else if (module.UTF8ToString) {
                data = module.UTF8ToString(resultPtr);
            } else {
                data = String(resultPtr);
            }
            
            if (!data || typeof data !== 'string') {
                throw new Error(`Invalid data from _compute(): ${typeof data}, value: ${data}`);
            }
            
            fullLixelData = parseOutputText(data, vueThis.NKDV.nkdv_type);
            timeCache.set(timeKey, {
                data: fullLixelData,
                params: currentParams
            });
            
            if (fullLixelData.length > 0) {
                const kdeValues = fullLixelData.map(item => item[4]);
                let minKDE = kdeValues[0];
                let maxKDE = kdeValues[0];
                for (let i = 1; i < kdeValues.length; i++) {
                    if (kdeValues[i] < minKDE) minKDE = kdeValues[i];
                    if (kdeValues[i] > maxKDE) maxKDE = kdeValues[i];
                }
                if (globalKDEMin === null || minKDE < globalKDEMin) {
                    globalKDEMin = minKDE;
                }
                if (globalKDEMax === null || maxKDE > globalKDEMax) {
                    globalKDEMax = maxKDE;
                }
            }
        }
    } else {
        if (!fullLixelData) {
            module._load_parameters(
                3, vueThis.NKDV.lixel, 2, vueThis.NKDV.bandwidth,
                1, 0, 0, 0, 0,
                vueThis.NKDV.lon_min, vueThis.NKDV.lon_max,
                vueThis.NKDV.lat_min, vueThis.NKDV.lat_max
            );
            
            const resultPtr = module._compute();
            let data;
            if (resultPtr === null || resultPtr === undefined) {
                throw new Error('_compute() returned null or undefined');
            } else if (typeof resultPtr === 'string') {
                data = resultPtr;
            } else if (module.UTF8ToString) {
                data = module.UTF8ToString(resultPtr);
            } else {
                data = String(resultPtr);
            }
            
            if (!data || typeof data !== 'string') {
                throw new Error(`Invalid data from _compute(): ${typeof data}, value: ${data}`);
            }
            
            fullLixelData = parseOutputText(data, vueThis.NKDV.nkdv_type);
        }
    }
    
    let filteredData = filterByBounds(fullLixelData, coords, vueThis.NKDV, vueThis.NKDV.nkdv_type);
    
    if (vueThis.NKDV.nkdv_type == 3) {
        filteredData = filterByTime(filteredData, vueThis.NKDV.cur_t, vueThis.NKDV.bandwidth_t);
    }
    
    const geojson = buildLineGeoJson(coords, filteredData, vueThis.NKDV.lixel, vueThis.NKDV.nkdv_type);
    return geojson;
}

async function precomputeAllTimePoints(vueThis) {
    if (isPrecomputing) return false;
    if (allTimeGeoJson !== null) return true;
    if (vueThis.NKDV.nkdv_type != 3) return false;
    
    isPrecomputing = true;
    console.log('[NKDV] Starting precomputation...');
    
    const module = await initModule();
    const coords = await loadEdgeGeometry();
    getBounds(vueThis);
    await ensureCorrectNetwork(vueThis);
    
    if (!currentParams) {
        currentParams = `${vueThis.NKDV.lixel}_${vueThis.NKDV.bandwidth}_${vueThis.NKDV.nkdv_type}_${vueThis.NKDV.bandwidth_t}`;
    }
    
    const t_L = vueThis.NKDV.t_L;
    const t_U = vueThis.NKDV.t_U;
    const t_pixels = vueThis.NKDV.t_pixels;
    const timeStep = (t_U - t_L) / t_pixels;
    const allFeatures = [];
    const allKdeValues = [];
    
    for (let i = 0; i < t_pixels; i++) {
        const cur_t = t_L + i * timeStep;
        const timeKey = getTimeCacheKey(cur_t);
        
        module._load_parameters(
            3, vueThis.NKDV.lixel, 2, vueThis.NKDV.bandwidth,
            vueThis.NKDV.nkdv_type, t_L, t_U, vueThis.NKDV.bandwidth_t, cur_t,
            vueThis.NKDV.lon_min, vueThis.NKDV.lon_max,
            vueThis.NKDV.lat_min, vueThis.NKDV.lat_max
        );
        
        const resultPtr = module._compute();
        let data;
        if (typeof resultPtr === 'string') {
            data = resultPtr;
        } else if (module.UTF8ToString) {
            data = module.UTF8ToString(resultPtr);
        } else {
            data = String(resultPtr);
        }
        
        const lixelData = parseOutputText(data, vueThis.NKDV.nkdv_type);
        
        if (lixelData.length > 0) {
            const kdeValues = lixelData.map(item => item[4]);
            allKdeValues.push(...kdeValues);
        }
        
        timeCache.set(timeKey, {
            data: lixelData,
            params: currentParams
        });
    }
    
    if (allKdeValues.length > 0) {
        let minVal = allKdeValues[0];
        let maxVal = allKdeValues[0];
        for (let i = 1; i < allKdeValues.length; i++) {
            if (allKdeValues[i] < minVal) minVal = allKdeValues[i];
            if (allKdeValues[i] > maxVal) maxVal = allKdeValues[i];
        }
        globalKDEMin = minVal;
        globalKDEMax = maxVal;
    }
    
    for (let i = 0; i < t_pixels; i++) {
        const cur_t = t_L + i * timeStep;
        const timeKey = getTimeCacheKey(cur_t);
        const cached = timeCache.get(timeKey);
        
        if (cached && cached.data) {
            const filteredData = filterByBounds(cached.data, coords, vueThis.NKDV, vueThis.NKDV.nkdv_type);
            const geojson = buildLineGeoJson(coords, filteredData, vueThis.NKDV.lixel, vueThis.NKDV.nkdv_type, timeKey);
            allFeatures.push(...geojson.features);
        }
    }
    
    allTimeGeoJson = {
        type: "FeatureCollection",
        features: allFeatures
    };
    
    isPrecomputing = false;
    console.log(`[NKDV] Precomputation complete: ${allFeatures.length} features`);
    return true;
}

async function loadHeatMap(vueThis) {
    return new Promise(async (resolve, reject) => {
        vueThis.map = new mapboxgl.Map({
            container: 'map',
            style: vueThis.mapStyle,
            center: [-122.4194, 37.7749],
            zoom: 13
        });
        
        vueThis.map.on('load', async function () {
            try {
                getBounds(vueThis);
                
                if (vueThis.NKDV.nkdv_type == 3) {
                    try {
                        await precomputeAllTimePoints(vueThis);
                    } catch (error) {
                        console.error('[NKDV] Precomputation failed:', error);
                    }
                    
                    if (allTimeGeoJson && allTimeGeoJson.features && allTimeGeoJson.features.length > 0) {
                        vueThis.map.addSource('nkdv', {
                            type: 'geojson',
                            data: allTimeGeoJson
                        });
                        
                        vueThis.map.addLayer({
                            id: 'nkdv-lines',
                            type: 'line',
                            source: 'nkdv',
                            paint: {
                                'line-width': 4,
                                'line-color': [
                                    'step',
                                    ['get', 'density'],
                                    'rgba(0, 0, 0, 0)',
                                    0.1, 'rgb(45, 59, 255)',
                                    0.2, 'rgb(39, 179, 243)',
                                    0.3, 'rgb(46, 226, 166)',
                                    0.4, 'rgb(179, 233, 109)',
                                    0.5, 'rgb(255, 240, 103)',
                                    0.6, 'rgb(255, 192, 57)',
                                    0.7, 'rgb(255, 127, 41)',
                                    0.8, 'rgb(255, 102, 64)',
                                    0.90, 'rgb(250, 74, 20)',
                                    0.95, 'rgb(211, 0, 0)',
                                    1.0, 'rgb(129, 0, 0)',
                                ],
                                'line-opacity': vueThis.NKDV.opacity
                            }
                        });
                        
                        const initialTimeKey = getTimeCacheKey(vueThis.NKDV.cur_t);
                        vueThis.map.setFilter('nkdv-lines', ['==', 'time', initialTimeKey]);
                        isMapReady = true;
                        resolve();
                        return;
                    }
                }
                
                let geojson = await compute_nkdv_with_bounds(vueThis);
                
                vueThis.map.addSource('nkdv', {
                    type: 'geojson',
                    data: geojson
                });
                
                vueThis.map.addLayer({
                    id: 'nkdv-lines',
                    type: 'line',
                    source: 'nkdv',
                    paint: {
                        'line-width': 4,
                        'line-color': [
                            'step',
                            ['get', 'density'],
                            'rgba(0, 0, 0, 0)',
                            0.1, 'rgb(45, 59, 255)',
                            0.2, 'rgb(39, 179, 243)',
                            0.3, 'rgb(46, 226, 166)',
                            0.4, 'rgb(179, 233, 109)',
                            0.5, 'rgb(255, 240, 103)',
                            0.6, 'rgb(255, 192, 57)',
                            0.7, 'rgb(255, 127, 41)',
                            0.8, 'rgb(255, 102, 64)',
                            0.90, 'rgb(250, 74, 20)',
                            0.95, 'rgb(211, 0, 0)',
                            1.0, 'rgb(129, 0, 0)',
                        ],
                        'line-opacity': vueThis.NKDV.opacity
                    }
                });
                
                isMapReady = true;
                resolve();
            } catch (error) {
                console.error('[NKDV] Error loading:', error);
                reject(error);
            }
        });
        
        vueThis.map.on('zoomend', function () {
            updateMapDebounced(vueThis);
        });
        
        vueThis.map.on('moveend', function () {
            updateMapDebounced(vueThis);
        });
    });
}

let isComputing = false;
let timeUpdateTimeout = null;

function updateMapDebounced(vueThis, delay = 500) {
    if (!isMapReady) return;
    
    if (isComputing) {
        if (updateTimeout) {
            clearTimeout(updateTimeout);
        }
        updateTimeout = setTimeout(() => {
            updateMapDebounced(vueThis, delay);
        }, 100);
        return;
    }
    
    if (updateTimeout) {
        clearTimeout(updateTimeout);
    }
    
    updateTimeout = setTimeout(() => {
        updateMap(vueThis);
    }, delay);
}

async function updateMap(vueThis) {
    if (isComputing) return;
    
    if (vueThis.NKDV.nkdv_type == 3 && allTimeGeoJson !== null) {
        console.warn('[NKDV] updateMap called but allTimeGeoJson exists');
    }
    
    try {
        isComputing = true;
        const source = vueThis.map.getSource('nkdv');
        if (!source) {
            isComputing = false;
            return;
        }
        
        let geojson = await compute_nkdv_with_bounds(vueThis);
        source.setData(geojson);
    } catch (error) {
        console.error('[NKDV] Error updating:', error);
    } finally {
        isComputing = false;
    }
}

function updateAtriibution(vueThis) {
    if (vueThis.NKDV.nkdv_type == 3 && allTimeGeoJson !== null) {
        clearCache();
        ensurePrecomputation(vueThis).then(() => {
            updateCurrentTime(vueThis);
        });
    } else {
        clearCache();
        updateMapDebounced(vueThis);
    }
}

function updateCurrentTime(vueThis) {
    if (vueThis.NKDV.nkdv_type == 3) {
        const layer = vueThis.map.getLayer('nkdv-lines');
        if (!layer) {
            console.warn('[NKDV] Layer not found');
            return;
        }
        
        if (allTimeGeoJson !== null) {
            const timeKey = getTimeCacheKey(vueThis.NKDV.cur_t);
            vueThis.map.setFilter('nkdv-lines', ['==', 'time', timeKey]);
            return;
        }
        
        if (isPrecomputing) return;
        
        const timeKey = getTimeCacheKey(vueThis.NKDV.cur_t);
        const cached = timeCache.get(timeKey);
        
        if (cached && cached.params === currentParams) {
            fullLixelData = cached.data;
            const coords = edgeCoords;
            if (coords) {
                const filteredData = filterByBounds(cached.data, coords, vueThis.NKDV, vueThis.NKDV.nkdv_type);
                const geojson = buildLineGeoJson(coords, filteredData, vueThis.NKDV.lixel, vueThis.NKDV.nkdv_type);
                const source = vueThis.map.getSource('nkdv');
                if (source) {
                    source.setData(geojson);
                }
            }
        } else {
            if (timeUpdateTimeout) {
                clearTimeout(timeUpdateTimeout);
            }
            timeUpdateTimeout = setTimeout(() => {
                updateMap(vueThis);
            }, 100);
        }
    }
}

async function ensurePrecomputation(vueThis) {
    if (allTimeGeoJson !== null) return true;
    if (isPrecomputing) return false;
    if (vueThis.NKDV.nkdv_type != 3) return false;
    
    try {
        const success = await precomputeAllTimePoints(vueThis);
        if (success && allTimeGeoJson) {
            const source = vueThis.map.getSource('nkdv');
            const layer = vueThis.map.getLayer('nkdv-lines');
            
            if (source) {
                source.setData(allTimeGeoJson);
                const initialTimeKey = getTimeCacheKey(vueThis.NKDV.cur_t);
                if (layer) {
                    vueThis.map.setFilter('nkdv-lines', ['==', 'time', initialTimeKey]);
                } else {
                    vueThis.map.addLayer({
                        id: 'nkdv-lines',
                        type: 'line',
                        source: 'nkdv',
                        paint: {
                            'line-width': 4,
                            'line-color': [
                                'step',
                                ['get', 'density'],
                                'rgba(0, 0, 0, 0)',
                                0.1, 'rgb(45, 59, 255)',
                                0.2, 'rgb(39, 179, 243)',
                                0.3, 'rgb(46, 226, 166)',
                                0.4, 'rgb(179, 233, 109)',
                                0.5, 'rgb(255, 240, 103)',
                                0.6, 'rgb(255, 192, 57)',
                                0.7, 'rgb(255, 127, 41)',
                                0.8, 'rgb(255, 102, 64)',
                                0.90, 'rgb(250, 74, 20)',
                                0.95, 'rgb(211, 0, 0)',
                                1.0, 'rgb(129, 0, 0)',
                            ],
                            'line-opacity': vueThis.NKDV.opacity
                        }
                    });
                    vueThis.map.setFilter('nkdv-lines', ['==', 'time', initialTimeKey]);
                }
                return true;
            }
        }
        return success;
    } catch (error) {
        console.error('[NKDV] Precomputation failed:', error);
        return false;
    }
}

export default {
    loadHeatMap,
    updateAtriibution,
    updateMap,
    getBounds,
    clearCache,
    updateCurrentTime,
    ensurePrecomputation
}

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

function parseOutputText(outputText, kdv_type = 1) {
    if (!outputText || typeof outputText !== 'string') {
        throw new Error(`parseOutputText: invalid input - expected string, got ${typeof outputText}: ${outputText}`);
    }
    
    const lines = outputText.trim().split('\n');
    if (lines.length === 0) {
        throw new Error('parseOutputText: empty output');
    }
    
    const numLixels = parseInt(lines[0]);
    if (isNaN(numLixels) || numLixels < 0) {
        throw new Error(`parseOutputText: invalid number of lixels: ${lines[0]}`);
    }
    
    const lixelData = [];

    for (let i = 1; i <= numLixels && i < lines.length; i++) {
        if (!lines[i] || lines[i].trim() === '') continue;
        const parts = lines[i].split(/\s+/).map(Number);
        if (kdv_type == 3) {
            if (parts.length >= 5) {
                const [edgeIndex, dist_n1, dist_n2, time, kde_value] = parts;
                lixelData.push([edgeIndex, dist_n1, dist_n2, time, kde_value]);
            }
        } else {
            if (parts.length >= 4) {
                const [edgeIndex, dist_n1, dist_n2, kde_value] = parts;
                lixelData.push([edgeIndex, dist_n1, dist_n2, kde_value]);
            }
        }
    }
    return lixelData;
}

function calculateLixelCoords(edgeCoords, edgeIndex, dist_n1, dist_n2) {
    const [n1, n2] = edgeCoords[edgeIndex];
    const ratio = dist_n1 / (dist_n1 + dist_n2);
    const lon = n1[0] + ratio * (n2[0] - n1[0]);
    const lat = n1[1] + ratio * (n2[1] - n1[1]);
    return [lon, lat];
}

function percentile(arr, p) {
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.floor((sorted.length - 1) * p);
    return sorted[index];
}

function normalizeKdeValues(values, method = 'minmax', useGlobalRange = false) {
    const clippedValues = values.map(v => Math.max(v, 0));
    const arr = Float64Array.from(clippedValues);
    let normalized;

    if (method === 'sum') {
        const total = arr.reduce((a, b) => a + b, 0);
        normalized = total > 0 ? arr.map(v => v / total) : arr;
    } else if (method === 'minmax') {
        let min, max;
        if (useGlobalRange && globalKDEMin !== null && globalKDEMax !== null) {
            min = globalKDEMin;
            max = globalKDEMax;
        } else {
            if (arr.length > 10) {
                min = percentile(Array.from(arr), 0.02);
                max = percentile(Array.from(arr), 0.98);
            } else {
                min = arr[0];
                max = arr[0];
                for (let i = 1; i < arr.length; i++) {
                    if (arr[i] < min) min = arr[i];
                    if (arr[i] > max) max = arr[i];
                }
            }
        }
        normalized = arr.map(v => {
            const normalizedValue = (v - min) / (max - min + 1e-8);
            return Math.max(0, Math.min(1, normalizedValue));
        });
    } else if (method === 'zscore') {
        const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
        const std = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
        normalized = arr.map(v => (v - mean) / (std + 1e-8));
    } else {
        throw new Error("Unsupported normalization method");
    }

    return normalized;
}

function buildGeoJson(edgeCoords, lixelData) {
    const kdeValues = lixelData.map(item => item[3]);
    const normKde = normalizeKdeValues(kdeValues, 'minmax');

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
                density: normKde[i]
            }
        };
    });

    return {
        type: "FeatureCollection",
        features
    };
}

function filterByTime(lixelData, cur_t, bandwidth_t) {
    const timeWindowMin = cur_t - bandwidth_t;
    const timeWindowMax = cur_t + bandwidth_t;
    return lixelData.filter(([edgeIndex, dist_n1, dist_n2, time, kde_value]) => {
        return time >= timeWindowMin && time <= timeWindowMax;
    });
}

function buildLineGeoJson(edgeCoords, lixelData, lixel_reg_length, kdv_type = 1, timeValue = null) {
    let kdeValues;
    if (kdv_type == 3) {
        kdeValues = lixelData.map(item => item[4]);
    } else {
        kdeValues = lixelData.map(item => item[3]);
    }

    const useGlobalRange = false;
    const normalizedValues = normalizeKdeValues(kdeValues, 'minmax', useGlobalRange);
    const features = [];
    const edgeLixels = {};
    
    lixelData.forEach((data, i) => {
        let edgeIndex, distN1, distN2;
        if (kdv_type == 3) {
            [edgeIndex, distN1, distN2] = data;
        } else {
            [edgeIndex, distN1, distN2] = data;
        }
        const kdeValue = normalizedValues[i];
        if (!edgeLixels[edgeIndex]) {
            edgeLixels[edgeIndex] = [];
        }
        edgeLixels[edgeIndex].push([distN1, distN2, kdeValue]);
    });

    for (const edgeIndex in edgeCoords) {
        const coords = edgeCoords[edgeIndex];
        const lixelList = edgeLixels[edgeIndex];

        if (!lixelList) continue;

        const [n1Coords, n2Coords] = coords;
        lixelList.sort((a, b) => a[0] - b[0]);
        let prevPoint = [...n1Coords];

        lixelList.forEach((data) => {
            const [distN1, distN2, kdeValue] = data;
            const totalLength = distN1 + distN2;
            let ratio = (distN1 + lixel_reg_length/2) / totalLength;
            if (ratio > 1) ratio = 1;

            const currentPoint = [
                n1Coords[0] + ratio * (n2Coords[0] - n1Coords[0]),
                n1Coords[1] + ratio * (n2Coords[1] - n1Coords[1]),
            ];

            const segment = {
                type: "Feature",
                geometry: {
                    type: "LineString",
                    coordinates: [prevPoint, currentPoint],
                },
                properties: {
                    edge_index: parseInt(edgeIndex),
                    density: parseFloat(kdeValue),
                },
            };
            
            if (kdv_type == 3 && timeValue !== null) {
                segment.properties.time = timeValue;
            }
            
            features.push(segment);
            prevPoint = currentPoint;
        });
    }

    return {
        type: "FeatureCollection",
        features,
    };
}