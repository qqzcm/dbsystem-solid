// 使用全局变量 NKDVModule（通过 script 标签加载）
let nkdvModule = null;
let edgeCoords = null;
let updateTimeout = null;
let isMapReady = false;

// 性能优化：多时间点缓存
// 对于时空模式，为不同的 cur_t 值分别缓存计算结果
let timeCache = new Map();  // key: cur_t (rounded), value: {data, params}
let fullLixelData = null;  // 当前使用的缓存数据
let currentParams = null;  // 记录当前参数（不含 cur_t）

// 全局归一化范围（用于跨时间点的一致性可视化）
let globalKDEMin = null;
let globalKDEMax = null;

// 预计算所有时间点的完整 GeoJSON（类似 KDV 的实现）
let allTimeGeoJson = null;  // 包含所有时间点的 GeoJSON，每个 feature 有 time 属性
let isPrecomputing = false;  // 是否正在预计算

// 跟踪当前加载的网络类型
let currentNetworkType = 1; // 1 = spatial, 3 = spatiotemporal

// 初始化模块（只执行一次）
async function initModule() {
    if (!nkdvModule) {
        // 等待全局 NKDVModule 可用
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
        
        // 使用全局 NKDVModule，配置 locateFile
        nkdvModule = await NKDVModule({
            locateFile: (path, prefix) => {
                if (path.endsWith('.data')) {
                    return '/js/nkdvWasm/nkdvCpp.data';
                }
                return prefix + path;
            }
        });
        
        // 默认加载空间网络（只执行一次）
        nkdvModule._load_network();
        currentNetworkType = 1;
        console.log('[NKDV] Module initialized with spatial network');
    }
    return nkdvModule;
}

// 根据 nkdv_type 加载相应的网络
async function ensureCorrectNetwork(vueThis) {
    const module = await initModule();
    const targetType = vueThis.NKDV.nkdv_type;
    
    // 如果网络类型不匹配，需要重新加载
    if (currentNetworkType !== targetType) {
        console.log(`[NKDV] Switching network type: ${currentNetworkType} -> ${targetType}`);
        
        // 重置网络
        module._reset_network();
        
        // 根据类型加载相应的网络
        if (targetType == 3) {
            // 加载时空网络
            if (module._load_spatiotemporal_network) {
                module._load_spatiotemporal_network();
            } else {
                console.warn('[NKDV] _load_spatiotemporal_network not available, using regular network');
                module._load_network();
            }
            currentNetworkType = 3;
        } else {
            // 加载空间网络
            module._load_network();
            currentNetworkType = 1;
        }
        
        // 清除缓存，因为网络已改变
        clearCache();
    }
}

// 加载边几何数据（只执行一次）
async function loadEdgeGeometry() {
    if (!edgeCoords) {
        const response = await fetch('/data/NKDV/edges_geometry.csv');
        if (!response.ok) throw new Error('Failed to load edge geometry');
        const text = await response.text();
        edgeCoords = parseCsv(text);
        console.log(`[NKDV] Loaded geometry for ${Object.keys(edgeCoords).length} edges`);
    }
    return edgeCoords;
}

// 获取地图边界（模仿 KDV 的 getBounds）
function getBounds(vueThis) {
    let bounds = vueThis.map.getBounds();
    if (bounds) {
        let sw = bounds.getSouthWest();
        let ne = bounds.getNorthEast();
        
        // 更新 NKDV 配置中的边界
        vueThis.NKDV.lon_min = sw.lng;
        vueThis.NKDV.lon_max = ne.lng;
        vueThis.NKDV.lat_min = sw.lat;
        vueThis.NKDV.lat_max = ne.lat;
        
        console.log('[NKDV] Bounds updated:', {
            lon: [vueThis.NKDV.lon_min.toFixed(4), vueThis.NKDV.lon_max.toFixed(4)],
            lat: [vueThis.NKDV.lat_min.toFixed(4), vueThis.NKDV.lat_max.toFixed(4)]
        });
    }
}

// 手动过滤边界外的 lixels（支持时空模式）
function filterByBounds(lixelData, edgeCoords, bounds, kdv_type = 1) {
    if (kdv_type == 3) {
        // 时空模式：数据格式为 [edgeIndex, dist_n1, dist_n2, time, kde_value]
        return lixelData.filter(([edgeIndex, dist_n1, dist_n2, time, kde_value]) => {
            const [lon, lat] = calculateLixelCoords(edgeCoords, edgeIndex, dist_n1, dist_n2);
            return lon >= bounds.lon_min && lon <= bounds.lon_max &&
                   lat >= bounds.lat_min && lat <= bounds.lat_max;
        });
    } else {
        // 空间模式：数据格式为 [edgeIndex, dist_n1, dist_n2, kde_value]
        return lixelData.filter(([edgeIndex, dist_n1, dist_n2, kde_value]) => {
            const [lon, lat] = calculateLixelCoords(edgeCoords, edgeIndex, dist_n1, dist_n2);
            return lon >= bounds.lon_min && lon <= bounds.lon_max &&
                   lat >= bounds.lat_min && lat <= bounds.lat_max;
        });
    }
}

// 检查参数是否改变（不含 cur_t，因为 cur_t 使用单独的缓存）
function paramsChanged(vueThis) {
    // 构建参数字符串（不含 cur_t，因为时空模式使用多时间点缓存）
    let newParams = `${vueThis.NKDV.lixel}_${vueThis.NKDV.bandwidth}_${vueThis.NKDV.nkdv_type}_${vueThis.NKDV.bandwidth_t}`;
    
    if (currentParams !== newParams) {
        currentParams = newParams;
        return true;
    }
    return false;
}

// 获取时间缓存的 key（将 cur_t 四舍五入到小数点后 2 位，以减少缓存数量）
function getTimeCacheKey(cur_t) {
    return Math.round(cur_t * 100) / 100;
}

// 清除缓存
function clearCache() {
    fullLixelData = null;
    timeCache.clear();
    allTimeGeoJson = null;  // 清除预计算的 GeoJSON
    // 注意：不清除全局归一化范围，以保持跨时间点的一致性
    console.log('[NKDV] Cache cleared');
}

// 计算 NKDV（带边界裁剪 + 多时间点缓存优化）
async function compute_nkdv_with_bounds(vueThis) {
    const module = await initModule();
    const coords = await loadEdgeGeometry();
    
    // 获取当前边界
    getBounds(vueThis);
    
    // 检查参数是否改变（不含 cur_t），如果改变则清除所有缓存
    if (paramsChanged(vueThis)) {
        clearCache();
    }
    
    // 确保加载了正确的网络类型
    await ensureCorrectNetwork(vueThis);
    
    // 对于时空模式，使用多时间点缓存
    if (vueThis.NKDV.nkdv_type == 3) {
        const timeKey = getTimeCacheKey(vueThis.NKDV.cur_t);
        const cached = timeCache.get(timeKey);
        
        // 检查是否有该时间点的缓存
        if (cached && cached.params === currentParams) {
            // 使用缓存的数据
            fullLixelData = cached.data;
            console.log(`[NKDV] ⚡ Using cached data for cur_t=${vueThis.NKDV.cur_t} (timeKey=${timeKey})`);
        } else {
            // 需要重新计算该时间点
            console.log(`[NKDV] 🔄 Computing for cur_t=${vueThis.NKDV.cur_t} (timeKey=${timeKey})...`);
            
            // 设置参数（时空模式）
            module._load_parameters(
                3,                              // method
                vueThis.NKDV.lixel,             // lixel_reg_length
                2,                              // k_type
                vueThis.NKDV.bandwidth,         // bandwidth
                vueThis.NKDV.nkdv_type,         // kdv_type (3 = spatiotemporal)
                vueThis.NKDV.t_L,               // t_L
                vueThis.NKDV.t_U,               // t_U
                vueThis.NKDV.bandwidth_t,       // bandwidth_t
                vueThis.NKDV.cur_t,             // cur_t
                vueThis.NKDV.lon_min,           // x_L
                vueThis.NKDV.lon_max,           // x_U
                vueThis.NKDV.lat_min,           // y_L
                vueThis.NKDV.lat_max            // y_U
            );
            
            // 执行计算
            const startTime = performance.now();
            const resultPtr = module._compute();
            
            let data;
            if (resultPtr === null || resultPtr === undefined) {
                throw new Error('_compute() returned null or undefined');
            } else if (typeof resultPtr === 'string') {
                data = resultPtr;
            } else if (module.UTF8ToString) {
                data = module.UTF8ToString(resultPtr);
            } else {
                console.warn('[NKDV] UTF8ToString not available, using direct conversion');
                data = String(resultPtr);
            }
            
            if (!data || typeof data !== 'string') {
                throw new Error(`Invalid data from _compute(): ${typeof data}, value: ${data}`);
            }
            
            const endTime = performance.now();
            console.log(`[NKDV] ⏱️  Computation time: ${(endTime - startTime).toFixed(2)}ms`);
            
            // 解析结果
            fullLixelData = parseOutputText(data, vueThis.NKDV.nkdv_type);
            console.log(`[NKDV] 💾 Cached ${fullLixelData.length} lixels for cur_t=${vueThis.NKDV.cur_t}`);
            
            // 缓存该时间点的结果
            timeCache.set(timeKey, {
                data: fullLixelData,
                params: currentParams
            });
            console.log(`[NKDV] 📦 Time cache size: ${timeCache.size} time points`);
            
            // 更新全局归一化范围（使用循环避免栈溢出）
            if (fullLixelData.length > 0) {
                const kdeValues = fullLixelData.map(item => item[4]);
                let minKDE = kdeValues[0];
                let maxKDE = kdeValues[0];
                for (let i = 1; i < kdeValues.length; i++) {
                    if (kdeValues[i] < minKDE) minKDE = kdeValues[i];
                    if (kdeValues[i] > maxKDE) maxKDE = kdeValues[i];
                }
                const avgKDE = kdeValues.reduce((a, b) => a + b, 0) / kdeValues.length;
                console.log(`[NKDV] 📊 KDE stats: min=${minKDE.toFixed(4)}, max=${maxKDE.toFixed(4)}, avg=${avgKDE.toFixed(4)}, cur_t=${vueThis.NKDV.cur_t}`);
                
                if (globalKDEMin === null || minKDE < globalKDEMin) {
                    globalKDEMin = minKDE;
                }
                if (globalKDEMax === null || maxKDE > globalKDEMax) {
                    globalKDEMax = maxKDE;
                }
                console.log(`[NKDV] 🌐 Global KDE range: [${globalKDEMin.toFixed(4)}, ${globalKDEMax.toFixed(4)}]`);
            }
        }
    } else {
        // 空间模式：使用单缓存
        if (!fullLixelData) {
            console.log('[NKDV] 🔄 First time computation, caching results...');
            
            // 设置参数（空间模式）
            module._load_parameters(
                3,                              // method
                vueThis.NKDV.lixel,             // lixel_reg_length
                2,                              // k_type
                vueThis.NKDV.bandwidth,         // bandwidth
                1,                              // kdv_type (1 = spatial)
                0,                              // t_L (dummy)
                0,                              // t_U (dummy)
                0,                              // bandwidth_t (dummy)
                0,                              // cur_t (dummy)
                vueThis.NKDV.lon_min,           // x_L
                vueThis.NKDV.lon_max,           // x_U
                vueThis.NKDV.lat_min,           // y_L
                vueThis.NKDV.lat_max            // y_U
            );
            
            // 执行计算
            const startTime = performance.now();
            const resultPtr = module._compute();
            
            let data;
            if (resultPtr === null || resultPtr === undefined) {
                throw new Error('_compute() returned null or undefined');
            } else if (typeof resultPtr === 'string') {
                data = resultPtr;
            } else if (module.UTF8ToString) {
                data = module.UTF8ToString(resultPtr);
            } else {
                console.warn('[NKDV] UTF8ToString not available, using direct conversion');
                data = String(resultPtr);
            }
            
            if (!data || typeof data !== 'string') {
                throw new Error(`Invalid data from _compute(): ${typeof data}, value: ${data}`);
            }
            
            const endTime = performance.now();
            console.log(`[NKDV] ⏱️  Full computation time: ${(endTime - startTime).toFixed(2)}ms`);
            
            // 解析并缓存结果
            fullLixelData = parseOutputText(data, vueThis.NKDV.nkdv_type);
            console.log(`[NKDV] 💾 Cached ${fullLixelData.length} lixels`);
        } else {
            console.log('[NKDV] ⚡ Using cached data (fast path)');
        }
    }
    
    // 过滤边界外的 lixels（使用缓存数据）
    const startFilter = performance.now();
    let filteredData = filterByBounds(fullLixelData, coords, vueThis.NKDV, vueThis.NKDV.nkdv_type);
    
    // 注意：对于时空模式，时间过滤已经在 C++ 端通过 cur_t 参数完成
    // 所以这里不需要再次过滤（因为所有输出的 lixel 都是基于当前 cur_t 计算的）
    // 但是，为了兼容性，我们仍然保留这个过滤逻辑（虽然它可能不会过滤掉任何数据）
    if (vueThis.NKDV.nkdv_type == 3) {
        // 在时空模式下，C++ 端已经根据 cur_t 计算了 KDE 值
        // 这里的时间过滤主要用于调试和验证
        filteredData = filterByTime(filteredData, vueThis.NKDV.cur_t, vueThis.NKDV.bandwidth_t);
    }
    
    const endFilter = performance.now();
    console.log(`[NKDV] 🔍 Filtering time: ${(endFilter - startFilter).toFixed(2)}ms`);
    console.log(`[NKDV] ✅ After filtering: ${filteredData.length} lixels in bounds`);
    
    // 构建 GeoJSON（对于时空模式，如果使用预计算，不需要在这里构建）
    // 但如果使用缓存方式，仍然需要构建
    const geojson = buildLineGeoJson(coords, filteredData, vueThis.NKDV.lixel, vueThis.NKDV.nkdv_type);
    
    // 调试：检查最终 GeoJSON 的密度值范围（使用循环避免栈溢出）
    if (geojson.features.length > 0) {
        const densities = geojson.features.map(f => f.properties.density);
        let minDensity = densities[0];
        let maxDensity = densities[0];
        for (let i = 1; i < densities.length; i++) {
            if (densities[i] < minDensity) minDensity = densities[i];
            if (densities[i] > maxDensity) maxDensity = densities[i];
        }
        console.log(`[NKDV] 🎨 Final density range: [${minDensity.toFixed(4)}, ${maxDensity.toFixed(4)}], features=${geojson.features.length}`);
    }
    
    return geojson;
}

// 预计算所有时间点的数据（类似 KDV 的实现）
async function precomputeAllTimePoints(vueThis) {
    if (isPrecomputing) {
        console.log('[NKDV] Precomputation already in progress, skipping...');
        return false;
    }
    
    if (allTimeGeoJson !== null) {
        console.log('[NKDV] All time points already precomputed');
        return true;
    }
    
    if (vueThis.NKDV.nkdv_type != 3) {
        console.log('[NKDV] Not spatiotemporal mode, skipping precomputation');
        return false;
    }
    
    isPrecomputing = true;
    console.log('[NKDV] 🚀 Starting precomputation of all time points...');
    
    const module = await initModule();
    const coords = await loadEdgeGeometry();
    getBounds(vueThis);
    await ensureCorrectNetwork(vueThis);
    
    // 确保 currentParams 已设置
    if (!currentParams) {
        currentParams = `${vueThis.NKDV.lixel}_${vueThis.NKDV.bandwidth}_${vueThis.NKDV.nkdv_type}_${vueThis.NKDV.bandwidth_t}`;
    }
    
    // 计算所有时间点
    const t_L = vueThis.NKDV.t_L;
    const t_U = vueThis.NKDV.t_U;
    const t_pixels = vueThis.NKDV.t_pixels;
    const timeStep = (t_U - t_L) / t_pixels;
    
    const allFeatures = [];
    const allKdeValues = [];
    
    // 先计算所有时间点，收集所有 KDE 值用于全局归一化
    for (let i = 0; i < t_pixels; i++) {
        const cur_t = t_L + i * timeStep;
        const timeKey = getTimeCacheKey(cur_t);
        
        console.log(`[NKDV] Precomputing time point ${i + 1}/${t_pixels}: cur_t=${cur_t.toFixed(2)}`);
        
        // 设置参数
        module._load_parameters(
            3, vueThis.NKDV.lixel, 2, vueThis.NKDV.bandwidth,
            vueThis.NKDV.nkdv_type, t_L, t_U, vueThis.NKDV.bandwidth_t, cur_t,
            vueThis.NKDV.lon_min, vueThis.NKDV.lon_max,
            vueThis.NKDV.lat_min, vueThis.NKDV.lat_max
        );
        
        // 执行计算
        const resultPtr = module._compute();
        let data;
        if (typeof resultPtr === 'string') {
            data = resultPtr;
        } else if (module.UTF8ToString) {
            data = module.UTF8ToString(resultPtr);
        } else {
            data = String(resultPtr);
        }
        
        // 解析结果
        const lixelData = parseOutputText(data, vueThis.NKDV.nkdv_type);
        
        // 收集 KDE 值用于全局归一化
        if (lixelData.length > 0) {
            const kdeValues = lixelData.map(item => item[4]);
            allKdeValues.push(...kdeValues);
        }
        
        // 缓存该时间点的原始数据
        timeCache.set(timeKey, {
            data: lixelData,
            params: currentParams
        });
    }
    
    // 计算全局归一化范围（使用循环避免栈溢出）
    if (allKdeValues.length > 0) {
        let minVal = allKdeValues[0];
        let maxVal = allKdeValues[0];
        for (let i = 1; i < allKdeValues.length; i++) {
            if (allKdeValues[i] < minVal) minVal = allKdeValues[i];
            if (allKdeValues[i] > maxVal) maxVal = allKdeValues[i];
        }
        globalKDEMin = minVal;
        globalKDEMax = maxVal;
        console.log(`[NKDV] 🌐 Global KDE range: [${globalKDEMin.toFixed(4)}, ${globalKDEMax.toFixed(4)}]`);
    }
    
    // 构建包含所有时间点的 GeoJSON
    for (let i = 0; i < t_pixels; i++) {
        const cur_t = t_L + i * timeStep;
        const timeKey = getTimeCacheKey(cur_t);
        const cached = timeCache.get(timeKey);
        
        if (cached && cached.data) {
            // 过滤边界
            const filteredData = filterByBounds(cached.data, coords, vueThis.NKDV, vueThis.NKDV.nkdv_type);
            
            // 构建 GeoJSON（包含时间属性）
            const geojson = buildLineGeoJson(coords, filteredData, vueThis.NKDV.lixel, vueThis.NKDV.nkdv_type, timeKey);
            
            // 合并 features
            allFeatures.push(...geojson.features);
        }
    }
    
    allTimeGeoJson = {
        type: "FeatureCollection",
        features: allFeatures
    };
    
    isPrecomputing = false;
    console.log(`[NKDV] ✅ Precomputation complete: ${allFeatures.length} features across ${t_pixels} time points`);
    return true;
}

// 加载热力图
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
                // 初始化边界
                getBounds(vueThis);
                
                // 如果是时空模式，预计算所有时间点
                if (vueThis.NKDV.nkdv_type == 3) {
                    console.log('[NKDV] Spatiotemporal mode detected, precomputing all time points...');
                    try {
                        await precomputeAllTimePoints(vueThis);
                    } catch (error) {
                        console.error('[NKDV] ❌ Precomputation failed:', error);
                        // 继续使用原来的方式
                    }
                    
                    // 使用预计算的 GeoJSON
                    if (allTimeGeoJson && allTimeGeoJson.features && allTimeGeoJson.features.length > 0) {
                        console.log(`[NKDV] ✅ Precomputed ${allTimeGeoJson.features.length} features, adding to map...`);
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
                                    'step',  // 使用 step 函数，创建离散的颜色断点（类似 KDV）
                                    ['get', 'density'],
                                    'rgba(0, 0, 0, 0)',  // 如果 density 为 0，颜色为透明
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
                        
                        // 设置初始时间过滤器
                        const initialTimeKey = getTimeCacheKey(vueThis.NKDV.cur_t);
                        vueThis.map.setFilter('nkdv-lines', ['==', 'time', initialTimeKey]);
                        
                        isMapReady = true;
                        console.log(`[NKDV] ✅ Initial load complete with precomputed data (${allTimeGeoJson.features.length} features, timeKey=${initialTimeKey})`);
                        resolve();
                        return;
                    } else {
                        console.warn('[NKDV] ⚠️ Precomputation completed but allTimeGeoJson is empty or invalid, falling back to normal mode');
                    }
                }
                
                // 空间模式或预计算失败，使用原来的方式
                console.log('[NKDV] Computing initial data...');
                let geojson = await compute_nkdv_with_bounds(vueThis);
                
                // 添加数据源
                vueThis.map.addSource('nkdv', {
                    type: 'geojson',
                    data: geojson
                });
                
                // 添加图层
                vueThis.map.addLayer({
                    id: 'nkdv-lines',
                    type: 'line',
                    source: 'nkdv',
                    paint: {
                        'line-width': 4,
                        'line-color': [
                            'step',  // 使用 step 函数，创建离散的颜色断点（类似 KDV）
                            ['get', 'density'],
                            'rgba(0, 0, 0, 0)',  // 如果 density 为 0，颜色为透明
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
                
                // 标记地图已准备好
                isMapReady = true;
                console.log('[NKDV] Initial load complete');
                resolve();
            } catch (error) {
                console.error('[NKDV] Error loading:', error);
                reject(error);
            }
        });
        
        // 监听缩放事件（带防抖）
        vueThis.map.on('zoomend', function () {
            updateMapDebounced(vueThis);
        });
        
        // 监听移动事件（带防抖）
        vueThis.map.on('moveend', function () {
            updateMapDebounced(vueThis);
        });
    });
}

// 计算状态跟踪
let isComputing = false;
let timeUpdateTimeout = null;  // 专门用于时间更新的防抖定时器

// 带防抖的更新函数
function updateMapDebounced(vueThis, delay = 500) {
    // 如果地图还没准备好，不触发更新
    if (!isMapReady) {
        console.log('[NKDV] Map not ready yet, skipping update');
        return;
    }
    
    // 如果正在计算，等待完成
    if (isComputing) {
        console.log('[NKDV] Computation in progress, will retry after completion');
        // 设置一个较短的延迟，等待计算完成
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

// 更新地图（重新计算当前边界的 NKDV）
async function updateMap(vueThis) {
    if (isComputing) {
        console.log('[NKDV] Already computing, skipping duplicate update');
        return;
    }
    
    // 如果是时空模式且已预计算，不应该调用 updateMap（应该使用过滤器）
    // 但为了兼容性，如果边界改变了，可能需要重新预计算
    if (vueThis.NKDV.nkdv_type == 3 && allTimeGeoJson !== null) {
        console.warn('[NKDV] ⚠️ updateMap called but allTimeGeoJson exists. This may indicate boundary change or other issue.');
        // 如果边界改变了，预计算的数据可能不准确，需要清除并重新计算
        // 但为了性能，我们暂时不清除，让用户知道可能需要重新加载
    }
    
    try {
        isComputing = true;
        console.log('[NKDV] 🔄 Starting map update...');
        
        // 检查数据源是否存在
        const source = vueThis.map.getSource('nkdv');
        if (!source) {
            console.warn('[NKDV] Source not ready yet, skipping update');
            isComputing = false;
            return;
        }
        
        let geojson = await compute_nkdv_with_bounds(vueThis);
        
        // 更新数据源
        source.setData(geojson);
        
        console.log('[NKDV] ✅ Update complete');
    } catch (error) {
        console.error('[NKDV] ❌ Error updating:', error);
    } finally {
        isComputing = false;
    }
}

// 更新属性（保持兼容性）
// 当参数改变时，清除缓存并重新计算
function updateAtriibution(vueThis) {
    // 如果是时空模式且已预计算，参数改变时需要重新预计算
    if (vueThis.NKDV.nkdv_type == 3 && allTimeGeoJson !== null) {
        console.log('[NKDV] Parameters changed in spatiotemporal mode, need to recompute all time points...');
        clearCache();  // 清除预计算的 GeoJSON
        // 触发重新预计算
        ensurePrecomputation(vueThis).then(() => {
            // 预计算完成后，更新当前时间过滤器
            updateCurrentTime(vueThis);
        });
    } else {
        console.log('[NKDV] Parameters changed, clearing cache...');
        clearCache();  // 清除缓存，强制重新计算
        updateMapDebounced(vueThis);
    }
}

// 更新时间过滤（完全模仿 KDV 的实现）
function updateCurrentTime(vueThis) {
    if (vueThis.NKDV.nkdv_type == 3) {
        // 检查图层是否存在
        const layer = vueThis.map.getLayer('nkdv-lines');
        if (!layer) {
            console.warn('[NKDV] Layer not found, cannot update time filter');
            return;
        }
        
        // 如果已经预计算了所有时间点，使用 Mapbox 过滤器（非常快，类似 KDV）
        if (allTimeGeoJson !== null) {
            const timeKey = getTimeCacheKey(vueThis.NKDV.cur_t);
            vueThis.map.setFilter('nkdv-lines', ['==', 'time', timeKey]);
            // 不输出日志，避免控制台刷屏（类似 KDV 的简洁实现）
            return;  // 直接返回，不执行后续逻辑
        }
        
        // 如果没有预计算，检查是否正在预计算
        if (isPrecomputing) {
            // 预计算进行中，不执行任何操作，等待完成
            console.log('[NKDV] ⏰ Precomputation in progress, skipping time update...');
            return;
        }
        
        // 如果没有预计算且不在预计算中，说明预计算还没有触发
        // 这种情况不应该发生（应该在切换到时空模式时触发预计算）
        // 但为了兼容性，使用缓存方式作为后备
        const timeKey = getTimeCacheKey(vueThis.NKDV.cur_t);
        const cached = timeCache.get(timeKey);
        
        if (cached && cached.params === currentParams) {
            // 有缓存，直接使用（非常快），立即更新数据源
            fullLixelData = cached.data;
            const coords = edgeCoords;
            if (coords) {
                const filteredData = filterByBounds(cached.data, coords, vueThis.NKDV, vueThis.NKDV.nkdv_type);
                const geojson = buildLineGeoJson(coords, filteredData, vueThis.NKDV.lixel, vueThis.NKDV.nkdv_type);
                const source = vueThis.map.getSource('nkdv');
                if (source) {
                    source.setData(geojson);
                    console.log(`[NKDV] ⏰ Time updated using cache: cur_t=${vueThis.NKDV.cur_t} (fast, no precomputation)`);
                }
            }
        } else {
            // 无缓存，需要计算（这种情况应该尽量避免）
            // 只有在预计算失败或参数改变时才会发生
            console.warn(`[NKDV] ⚠️ No cache for cur_t=${vueThis.NKDV.cur_t}, allTimeGeoJson=${allTimeGeoJson}, computing...`);
            if (timeUpdateTimeout) {
                clearTimeout(timeUpdateTimeout);
            }
            timeUpdateTimeout = setTimeout(() => {
                updateMap(vueThis);
            }, 100);
        }
    }
}

// 导出预计算函数，供外部调用（例如在切换到时空模式时）
async function ensurePrecomputation(vueThis) {
    // 如果已经预计算或正在预计算，直接返回
    if (allTimeGeoJson !== null) {
        return true;
    }
    if (isPrecomputing) {
        console.log('[NKDV] Precomputation already in progress...');
        return false;
    }
    
    // 如果不是时空模式，不需要预计算
    if (vueThis.NKDV.nkdv_type != 3) {
        return false;
    }
    
    // 触发预计算
    try {
        const success = await precomputeAllTimePoints(vueThis);
        if (success && allTimeGeoJson) {
            // 如果地图已经加载，需要更新数据源
            const source = vueThis.map.getSource('nkdv');
            const layer = vueThis.map.getLayer('nkdv-lines');
            
            if (source) {
                source.setData(allTimeGeoJson);
                const initialTimeKey = getTimeCacheKey(vueThis.NKDV.cur_t);
                if (layer) {
                    vueThis.map.setFilter('nkdv-lines', ['==', 'time', initialTimeKey]);
                } else {
                    // 如果图层不存在，添加图层
                    vueThis.map.addLayer({
                        id: 'nkdv-lines',
                        type: 'line',
                        source: 'nkdv',
                        paint: {
                            'line-width': 4,
                            'line-color': [
                                'step',  // 使用 step 函数，创建离散的颜色断点（类似 KDV）
                                ['get', 'density'],
                                'rgba(0, 0, 0, 0)',  // 如果 density 为 0，颜色为透明
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
                console.log(`[NKDV] ✅ Precomputation complete and map updated (${allTimeGeoJson.features.length} features)`);
                return true;
            }
        }
        return success;
    } catch (error) {
        console.error('[NKDV] ❌ Precomputation failed:', error);
        return false;
    }
}

export default {
    loadHeatMap,
    updateAtriibution,
    updateMap,
    getBounds,
    clearCache,  // 导出清除缓存函数
    updateCurrentTime,  // 导出更新时间过滤函数
    ensurePrecomputation  // 导出确保预计算函数
}

function parseCsv(csvText) {
    const lines = csvText.trim().split('\n');
    const edgeCoords = {};
    for (let i = 1; i < lines.length; i++) { // 跳过标题行
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
        if (!lines[i] || lines[i].trim() === '') {
            continue; // 跳过空行
        }
        const parts = lines[i].split(/\s+/).map(Number);
        if (kdv_type == 3) {
            // 时空模式：edge_index dist_n1 dist_n2 time kde_value (5列)
            if (parts.length >= 5) {
                const [edgeIndex, dist_n1, dist_n2, time, kde_value] = parts;
                lixelData.push([edgeIndex, dist_n1, dist_n2, time, kde_value]);
            }
        } else {
            // 空间模式：edge_index dist_n1 dist_n2 kde_value (4列)
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

// 计算百分位数
function percentile(arr, p) {
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.floor((sorted.length - 1) * p);
    return sorted[index];
}

function normalizeKdeValues(values, method = 'minmax', useGlobalRange = false) {
    // 归一化前：将小于 0 的 KDE 值设为 0
    const clippedValues = values.map(v => Math.max(v, 0));

    const arr = Float64Array.from(clippedValues);
    let normalized;

    if (method === 'sum') {
        const total = arr.reduce((a, b) => a + b, 0);
        normalized = total > 0 ? arr.map(v => v / total) : arr;
    } else if (method === 'minmax') {
        let min, max;
        if (useGlobalRange && globalKDEMin !== null && globalKDEMax !== null) {
            // 使用全局范围进行归一化（跨时间点一致性）
            min = globalKDEMin;
            max = globalKDEMax;
        } else {
            // 使用百分位数归一化来扩大数据范围（排除极端值）
            // 使用 2% 和 98% 百分位数，让中间的数据范围更大
            if (arr.length > 10) {
                min = percentile(Array.from(arr), 0.02);  // 2% 百分位数
                max = percentile(Array.from(arr), 0.98);  // 98% 百分位数
            } else {
                // 数据太少，使用 min-max
                min = arr[0];
                max = arr[0];
                for (let i = 1; i < arr.length; i++) {
                    if (arr[i] < min) min = arr[i];
                    if (arr[i] > max) max = arr[i];
                }
            }
        }
        // 归一化到 [0, 1]，但允许超出范围的值（会被裁剪到 [0, 1]）
        normalized = arr.map(v => {
            const normalizedValue = (v - min) / (max - min + 1e-8);
            // 裁剪到 [0, 1] 范围
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

// 按时间过滤 lixel 数据（时空模式）
function filterByTime(lixelData, cur_t, bandwidth_t) {
    const beforeCount = lixelData.length;
    
    // 统计时间分布（用于调试，使用循环避免栈溢出）
    if (beforeCount > 0) {
        const timeValues = lixelData.map(item => item[3]); // 提取时间值
        let minTime = timeValues[0];
        let maxTime = timeValues[0];
        for (let i = 1; i < timeValues.length; i++) {
            if (timeValues[i] < minTime) minTime = timeValues[i];
            if (timeValues[i] > maxTime) maxTime = timeValues[i];
        }
        const uniqueTimes = [...new Set(timeValues)].sort((a, b) => a - b);
        console.log(`[NKDV] ⏰ Time stats: min=${minTime}, max=${maxTime}, unique times=${uniqueTimes.length}, sample=${uniqueTimes.slice(0, 5).join(',')}...`);
    }
    
    const timeWindowMin = cur_t - bandwidth_t;
    const timeWindowMax = cur_t + bandwidth_t;
    
    const filtered = lixelData.filter(([edgeIndex, dist_n1, dist_n2, time, kde_value]) => {
        return time >= timeWindowMin && time <= timeWindowMax;
    });
    
    console.log(`[NKDV] ⏰ Time filter: cur_t=${cur_t}, window=[${timeWindowMin}, ${timeWindowMax}], before=${beforeCount}, after=${filtered.length}`);
    
    return filtered;
}

function buildLineGeoJson(edgeCoords, lixelData, lixel_reg_length, kdv_type = 1, timeValue = null) {
    // 提取所有 KDE 值用于归一化
    let kdeValues;
    if (kdv_type == 3) {
        // 时空模式：数据格式为 [edgeIndex, dist_n1, dist_n2, time, kde_value]
        kdeValues = lixelData.map(item => item[4]);
    } else {
        // 空间模式：数据格式为 [edgeIndex, dist_n1, dist_n2, kde_value]
        kdeValues = lixelData.map(item => item[3]);
    }

    // 对于时空模式，使用每个时间点单独归一化，让变化更明显
    // 如果使用全局归一化，不同时间点的差异可能被压缩
    // 改为每个时间点单独归一化，每个时间点都会充分利用整个颜色范围
    const useGlobalRange = false;  // 改为 false，使用每个时间点单独归一化
    const normalizedValues = normalizeKdeValues(kdeValues, 'minmax', useGlobalRange);

    const features = [];

    // 按 edge_index 分组 lixel 数据
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

        if (!lixelList) {
            continue; // 跳过没有 lixel 数据的边
        }

        const [n1Coords, n2Coords] = coords;

        // 按 distN1 排序
        lixelList.sort((a, b) => a[0] - b[0]);

        let prevPoint = [...n1Coords]; // 初始起点为 n1

        lixelList.forEach((data) => {
            const [distN1, distN2, kdeValue] = data;
            const totalLength = distN1 + distN2;

            // 防止最后一段越界
            let ratio = (distN1 + lixel_reg_length/2) / totalLength;
            if (ratio > 1) {
                ratio = 1;
            }

            const currentPoint = [
                n1Coords[0] + ratio * (n2Coords[0] - n1Coords[0]),
                n1Coords[1] + ratio * (n2Coords[1] - n1Coords[1]),
            ];

            // 构建当前 lixel 对应的小段（上一个点 -> 当前点）
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
            
            // 如果是时空模式且提供了时间值，添加 time 属性（用于 Mapbox 过滤）
            if (kdv_type == 3 && timeValue !== null) {
                segment.properties.time = timeValue;
            }
            
            features.push(segment);

            // 更新上一个点为当前点
            prevPoint = currentPoint;
        });
    }

    return {
        type: "FeatureCollection",
        features,
    };
}