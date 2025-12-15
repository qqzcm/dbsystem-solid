/**
 * NKDV Spatiotemporal API: Network Kernel Density Visualization with Time Dimension
 * 
 * This module provides high-level JavaScript API for spatiotemporal NKDV analysis.
 * It extends the spatial-only Scenario B with time dimension support.
 * 
 * Features:
 * - Spatiotemporal kernel density estimation
 * - Time series analysis
 * - Temporal animation support
 * - Time window management
 */

// Import spatial functions if available
if (typeof computeNKDVScenarioB !== 'undefined') {
    console.log('Spatial NKDV API detected, extending with temporal capabilities');
}

/**
 * Spatiotemporal Scenario B: Pre-clipping with time dimension
 * 
 * @param {Object} bounds - Spatial bounding box
 * @param {Object} timeWindow - Time window
 * @param {Object} params - NKDV parameters
 * @returns {Promise<Object>} Spatiotemporal GeoJSON
 */
async function computeNKDVSpatiotemporal(bounds, timeWindow, params = {}) {
    console.log('=== NKDV Spatiotemporal Analysis ===');
    console.log('Spatial bounds:', bounds);
    console.log('Time window:', timeWindow);
    
    // Validate inputs
    if (!bounds || !timeWindow) {
        throw new Error('Both spatial bounds and time window are required');
    }
    
    if (timeWindow.t_L >= timeWindow.t_U) {
        throw new Error('Invalid time window: t_L must be less than t_U');
    }
    
    // Default spatiotemporal parameters
    const {
        method = 3,
        lixel_length = 50,
        k_type = 2,
        bandwidth = 500,
        kdv_type = 3,           // Force spatiotemporal mode
        bandwidth_t = 60,       // Default 1 minute temporal bandwidth
        k_type_t = 2           // Default Epanechnikov for temporal kernel
    } = params;
    
    try {
        // Ensure network and geometry are loaded
        await ensureNKDVInitialized();
        
        // Reset network for new computation
        Module.ccall('reset_network', null, [], []);
        
        // Set spatiotemporal parameters
        console.log('Setting spatiotemporal parameters...');
        console.log(`Spatial bandwidth: ${bandwidth}m, Temporal bandwidth: ${bandwidth_t}s`);
        
        Module.ccall('load_parameters', null,
            ['number', 'number', 'number', 'number', 'number',
             'number', 'number', 'number',
             'number', 'number', 'number', 'number'],
            [method, lixel_length, k_type, bandwidth, kdv_type,
             timeWindow.t_L, timeWindow.t_U, bandwidth_t,
             bounds.lon_min, bounds.lon_max, bounds.lat_min, bounds.lat_max]
        );
        
        // Execute spatiotemporal computation
        console.log('Computing spatiotemporal NKDV...');
        const startTime = performance.now();
        const outputText = Module.ccall('compute', 'string', [], []);
        const endTime = performance.now();
        
        console.log(`Spatiotemporal computation completed in ${(endTime - startTime).toFixed(2)}ms`);
        
        // Parse spatiotemporal results
        const lixelData = parseSpatiotemporalOutput(outputText);
        console.log(`Generated ${lixelData.length} spatiotemporal lixels`);
        
        if (lixelData.length === 0) {
            console.warn('No spatiotemporal lixels generated. Check time window and spatial bounds.');
        }
        
        // Build spatiotemporal GeoJSON
        const geoJson = buildSpatiotemporalGeoJson(window.edgeCoords, lixelData);
        
        return geoJson;
        
    } catch (error) {
        console.error('Error in spatiotemporal analysis:', error);
        throw error;
    }
}

/**
 * Parse spatiotemporal output from C++ compute function
 * 
 * @param {string} outputText - Raw output from compute()
 * @returns {Array} Array of [edge_index, dist_n1, dist_n2, time, kde_value]
 */
function parseSpatiotemporalOutput(outputText) {
    const lines = outputText.trim().split('\n');
    if (lines.length === 0) return [];
    
    const numLixels = parseInt(lines[0]);
    if (isNaN(numLixels) || numLixels <= 0) {
        console.warn('Invalid lixel count in output:', lines[0]);
        return [];
    }
    
    const lixelData = [];
    
    for (let i = 1; i < lines.length && lixelData.length < numLixels; i++) {
        const parts = lines[i].trim().split(/\s+/);
        
        // Spatiotemporal format: edge_index dist_n1 dist_n2 time kde_value
        if (parts.length >= 5) {
            const [edgeIndex, dist_n1, dist_n2, time, kde_value] = parts.map(Number);
            
            // Validate parsed values
            if (!isNaN(edgeIndex) && !isNaN(dist_n1) && !isNaN(dist_n2) && 
                !isNaN(time) && !isNaN(kde_value)) {
                lixelData.push([edgeIndex, dist_n1, dist_n2, time, kde_value]);
            } else {
                console.warn('Invalid lixel data:', parts);
            }
        } else {
            console.warn('Malformed lixel line:', lines[i]);
        }
    }
    
    return lixelData;
}

/**
 * Build spatiotemporal GeoJSON from lixel data
 * 
 * @param {Object} edgeCoords - Edge geometry coordinates
 * @param {Array} lixelData - Parsed lixel data
 * @param {string} normMethod - Normalization method
 * @returns {Object} Spatiotemporal GeoJSON FeatureCollection
 */
function buildSpatiotemporalGeoJson(edgeCoords, lixelData, normMethod = 'minmax') {
    if (!edgeCoords) {
        throw new Error('Edge coordinates not available. Call load_geometry first.');
    }
    
    if (lixelData.length === 0) {
        return {
            type: "FeatureCollection",
            features: [],
            metadata: {
                type: "spatiotemporal",
                total_lixels: 0,
                time_range: null,
                density_range: null
            }
        };
    }
    
    // Extract and normalize KDE values
    const kdeValues = lixelData.map(item => item[4]);
    const normKde = normalizeKdeValues(kdeValues, normMethod);
    
    // Extract time values for metadata
    const timeValues = lixelData.map(item => item[3]);
    const minTime = Math.min(...timeValues);
    const maxTime = Math.max(...timeValues);
    
    // Build features
    const features = lixelData.map(([edgeIndex, dist_n1, dist_n2, time, kde_value], i) => {
        const [lon, lat] = calculateLixelCoords(edgeCoords, edgeIndex, dist_n1, dist_n2);
        
        return {
            type: "Feature",
            geometry: {
                type: "Point",
                coordinates: [lon, lat]
            },
            properties: {
                edge_index: edgeIndex,
                dist_n1: dist_n1,
                dist_n2: dist_n2,
                time: time,                                    // Unix timestamp
                density: normKde[i],                          // Normalized density [0,1]
                raw_density: kde_value,                       // Raw spatiotemporal KDE value
                datetime: formatTimestamp(time),              // Human-readable time
                temporal_weight: calculateTemporalWeight(time, minTime, maxTime)
            }
        };
    });
    
    return {
        type: "FeatureCollection",
        features: features,
        metadata: {
            type: "spatiotemporal",
            total_lixels: features.length,
            time_range: {
                min: minTime,
                max: maxTime,
                span: maxTime - minTime,
                min_datetime: formatTimestamp(minTime),
                max_datetime: formatTimestamp(maxTime)
            },
            density_range: {
                min: Math.min(...kdeValues),
                max: Math.max(...kdeValues),
                mean: kdeValues.reduce((a, b) => a + b, 0) / kdeValues.length
            }
        }
    };
}

/**
 * Time series analysis: analyze multiple time windows
 * 
 * @param {Object} bounds - Spatial bounds
 * @param {Array} timeWindows - Array of time windows
 * @param {Object} params - NKDV parameters
 * @returns {Promise<Object>} Time series results
 */
async function analyzeTimeSeriesNKDV(bounds, timeWindows, params = {}) {
    console.log(`=== Time Series Analysis: ${timeWindows.length} windows ===`);
    
    if (!Array.isArray(timeWindows) || timeWindows.length === 0) {
        throw new Error('Time windows array is required and must not be empty');
    }
    
    const results = {};
    const overallStats = {
        total_windows: timeWindows.length,
        total_lixels: 0,
        time_span: {
            start: Math.min(...timeWindows.map(w => w.t_L)),
            end: Math.max(...timeWindows.map(w => w.t_U))
        }
    };
    
    for (let i = 0; i < timeWindows.length; i++) {
        const window = timeWindows[i];
        const windowId = `window_${i.toString().padStart(3, '0')}`;
        
        console.log(`\nAnalyzing window ${i + 1}/${timeWindows.length}`);
        console.log(`Time: ${formatTimestamp(window.t_L)} - ${formatTimestamp(window.t_U)}`);
        
        try {
            const geoJson = await computeNKDVSpatiotemporal(bounds, window, params);
            
            // Calculate window statistics
            const densities = geoJson.features.map(f => f.properties.raw_density);
            const stats = calculateStatistics(densities);
            
            results[windowId] = {
                index: i,
                timeWindow: window,
                geoJson: geoJson,
                stats: stats,
                datetime: {
                    start: formatTimestamp(window.t_L),
                    end: formatTimestamp(window.t_U),
                    duration: window.t_U - window.t_L
                }
            };
            
            overallStats.total_lixels += geoJson.features.length;
            
            console.log(`Window ${i + 1} stats:`, stats);
            
        } catch (error) {
            console.error(`Error in window ${i + 1}:`, error);
            results[windowId] = {
                index: i,
                timeWindow: window,
                error: error.message,
                stats: null
            };
        }
    }
    
    return {
        results: results,
        metadata: overallStats,
        summary: generateTimeSeriesSummary(results)
    };
}

/**
 * Generate time windows for regular intervals
 * 
 * @param {number} startTime - Start timestamp
 * @param {number} endTime - End timestamp  
 * @param {number} windowSize - Window size in seconds
 * @param {number} stepSize - Step size in seconds (default: windowSize)
 * @returns {Array} Array of time windows
 */
function generateTimeWindows(startTime, endTime, windowSize, stepSize = null) {
    if (stepSize === null) stepSize = windowSize;
    
    const windows = [];
    
    for (let t = startTime; t < endTime; t += stepSize) {
        const windowEnd = Math.min(t + windowSize, endTime);
        windows.push({
            t_L: t,
            t_U: windowEnd
        });
        
        if (windowEnd >= endTime) break;
    }
    
    console.log(`Generated ${windows.length} time windows`);
    console.log(`Window size: ${windowSize}s, Step size: ${stepSize}s`);
    
    return windows;
}

/**
 * Filter spatiotemporal features by time
 * 
 * @param {Object} geoJson - Spatiotemporal GeoJSON
 * @param {number} targetTime - Target timestamp
 * @param {number} timeWindow - Time window around target (±seconds)
 * @returns {Object} Filtered GeoJSON
 */
function filterByTime(geoJson, targetTime, timeWindow = 60) {
    const filteredFeatures = geoJson.features.filter(feature => {
        const featureTime = feature.properties.time;
        return Math.abs(featureTime - targetTime) <= timeWindow;
    });
    
    return {
        type: "FeatureCollection",
        features: filteredFeatures,
        metadata: {
            ...geoJson.metadata,
            filtered: true,
            filter_time: targetTime,
            filter_window: timeWindow,
            original_count: geoJson.features.length,
            filtered_count: filteredFeatures.length
        }
    };
}

/**
 * Create temporal animation frames
 * 
 * @param {Object} geoJson - Spatiotemporal GeoJSON
 * @param {number} frameCount - Number of animation frames
 * @param {number} frameWindow - Time window for each frame
 * @returns {Array} Array of animation frames
 */
function createTemporalAnimation(geoJson, frameCount = 50, frameWindow = 60) {
    if (!geoJson.metadata || !geoJson.metadata.time_range) {
        throw new Error('GeoJSON must have time_range metadata');
    }
    
    const timeRange = geoJson.metadata.time_range;
    const timeSpan = timeRange.max - timeRange.min;
    const frameStep = timeSpan / (frameCount - 1);
    
    const frames = [];
    
    for (let i = 0; i < frameCount; i++) {
        const frameTime = timeRange.min + i * frameStep;
        const frameData = filterByTime(geoJson, frameTime, frameWindow);
        
        frames.push({
            index: i,
            time: frameTime,
            datetime: formatTimestamp(frameTime),
            progress: i / (frameCount - 1),
            data: frameData
        });
    }
    
    console.log(`Created ${frames.length} animation frames`);
    return frames;
}

/**
 * Aggregate spatiotemporal data by time intervals
 * 
 * @param {Object} geoJson - Spatiotemporal GeoJSON
 * @param {number} intervalSize - Interval size in seconds
 * @returns {Object} Aggregated data
 */
function aggregateByTimeInterval(geoJson, intervalSize = 3600) {
    if (!geoJson.metadata || !geoJson.metadata.time_range) {
        throw new Error('GeoJSON must have time_range metadata');
    }
    
    const timeRange = geoJson.metadata.time_range;
    const startTime = Math.floor(timeRange.min / intervalSize) * intervalSize;
    const endTime = Math.ceil(timeRange.max / intervalSize) * intervalSize;
    
    const intervals = {};
    
    // Initialize intervals
    for (let t = startTime; t < endTime; t += intervalSize) {
        const intervalKey = t.toString();
        intervals[intervalKey] = {
            start_time: t,
            end_time: t + intervalSize,
            start_datetime: formatTimestamp(t),
            end_datetime: formatTimestamp(t + intervalSize),
            features: [],
            stats: null
        };
    }
    
    // Assign features to intervals
    geoJson.features.forEach(feature => {
        const featureTime = feature.properties.time;
        const intervalStart = Math.floor(featureTime / intervalSize) * intervalSize;
        const intervalKey = intervalStart.toString();
        
        if (intervals[intervalKey]) {
            intervals[intervalKey].features.push(feature);
        }
    });
    
    // Calculate statistics for each interval
    Object.values(intervals).forEach(interval => {
        if (interval.features.length > 0) {
            const densities = interval.features.map(f => f.properties.raw_density);
            interval.stats = calculateStatistics(densities);
        } else {
            interval.stats = {
                count: 0,
                mean: 0,
                max: 0,
                min: 0,
                std: 0
            };
        }
    });
    
    return {
        intervals: intervals,
        metadata: {
            interval_size: intervalSize,
            total_intervals: Object.keys(intervals).length,
            time_range: timeRange,
            aggregation_method: 'time_interval'
        }
    };
}

// Utility functions

/**
 * Ensure NKDV is properly initialized
 */
async function ensureNKDVInitialized() {
    if (!window.Module) {
        throw new Error('NKDV Module not initialized. Call NKDVModule() first.');
    }
    
    // Load network if not already loaded
    if (!window.networkLoaded) {
        console.log('Loading network...');
        Module.ccall('load_network', null, [], []);
        window.networkLoaded = true;
    }
    
    // Load geometry if not already loaded
    if (!window.geometryLoaded) {
        console.log('Loading geometry...');
        Module.ccall('load_geometry', null, ['string'], ['edges_geometry.csv']);
        window.geometryLoaded = true;
    }
    
    // Load edge coordinates for JavaScript processing
    if (!window.edgeCoords) {
        console.log('Loading edge coordinates...');
        const response = await fetch('edges_geometry.csv');
        const csvText = await response.text();
        window.edgeCoords = parseCsv(csvText);
        console.log(`Loaded geometry for ${Object.keys(window.edgeCoords).length} edges`);
    }
}

/**
 * Format timestamp to human-readable string
 */
function formatTimestamp(timestamp, includeSeconds = true) {
    const date = new Date(timestamp * 1000);
    const options = {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    };
    
    if (includeSeconds) {
        options.second = '2-digit';
    }
    
    return date.toLocaleString('en-US', options);
}

/**
 * Calculate temporal weight based on position in time range
 */
function calculateTemporalWeight(time, minTime, maxTime) {
    if (maxTime === minTime) return 1.0;
    return (time - minTime) / (maxTime - minTime);
}

/**
 * Calculate comprehensive statistics
 */
function calculateStatistics(values) {
    if (values.length === 0) {
        return {
            count: 0,
            mean: 0,
            max: 0,
            min: 0,
            std: 0,
            median: 0,
            q25: 0,
            q75: 0
        };
    }
    
    const sorted = [...values].sort((a, b) => a - b);
    const count = values.length;
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / count;
    
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / count;
    const std = Math.sqrt(variance);
    
    const median = sorted[Math.floor(count / 2)];
    const q25 = sorted[Math.floor(count * 0.25)];
    const q75 = sorted[Math.floor(count * 0.75)];
    
    return {
        count: count,
        mean: mean,
        max: Math.max(...values),
        min: Math.min(...values),
        std: std,
        median: median,
        q25: q25,
        q75: q75
    };
}

/**
 * Generate summary for time series analysis
 */
function generateTimeSeriesSummary(results) {
    const validResults = Object.values(results).filter(r => r.stats !== null);
    
    if (validResults.length === 0) {
        return {
            valid_windows: 0,
            total_windows: Object.keys(results).length,
            error_rate: 1.0
        };
    }
    
    const allCounts = validResults.map(r => r.stats.count);
    const allMeans = validResults.map(r => r.stats.mean);
    const allMaxes = validResults.map(r => r.stats.max);
    
    return {
        valid_windows: validResults.length,
        total_windows: Object.keys(results).length,
        error_rate: 1 - (validResults.length / Object.keys(results).length),
        lixel_counts: calculateStatistics(allCounts),
        mean_densities: calculateStatistics(allMeans),
        max_densities: calculateStatistics(allMaxes),
        temporal_trend: calculateTemporalTrend(validResults)
    };
}

/**
 * Calculate temporal trend
 */
function calculateTemporalTrend(results) {
    if (results.length < 2) return null;
    
    const points = results.map(r => ({
        x: r.index,
        y: r.stats.mean
    }));
    
    // Simple linear regression
    const n = points.length;
    const sumX = points.reduce((sum, p) => sum + p.x, 0);
    const sumY = points.reduce((sum, p) => sum + p.y, 0);
    const sumXY = points.reduce((sum, p) => sum + p.x * p.y, 0);
    const sumXX = points.reduce((sum, p) => sum + p.x * p.x, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    return {
        slope: slope,
        intercept: intercept,
        direction: slope > 0 ? 'increasing' : slope < 0 ? 'decreasing' : 'stable'
    };
}

// Re-use spatial utility functions if available
if (typeof parseCsv === 'undefined') {
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
}

if (typeof calculateLixelCoords === 'undefined') {
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
}

if (typeof normalizeKdeValues === 'undefined') {
    function normalizeKdeValues(values, method = 'minmax') {
        const arr = Float64Array.from(values);
        if (method === 'minmax') {
            const min = Math.min(...arr);
            const max = Math.max(...arr);
            return arr.map(v => (v - min) / (max - min + 1e-8));
        }
        return arr;
    }
}

// Export functions for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        computeNKDVSpatiotemporal,
        analyzeTimeSeriesNKDV,
        generateTimeWindows,
        filterByTime,
        createTemporalAnimation,
        aggregateByTimeInterval,
        formatTimestamp
    };
}

console.log('NKDV Spatiotemporal API loaded');