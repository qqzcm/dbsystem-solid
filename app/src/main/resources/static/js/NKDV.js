import createModule from '/js/nkdvWasm/nkdvCpp.js';

let nkdvModule = null;
let edgeCoords = null;
let updateTimeout = null;
let isMapReady = false;

// 性能优化：缓存完整计算结果
let fullLixelData = null;
let currentParams = null;  // 记录当前参数

// 初始化模块（只执行一次）
async function initModule() {
    if (!nkdvModule) {
        nkdvModule = await createModule({
            locateFile: (path, prefix) => {
                if (path.endsWith('.data')) {
                    return '/js/nkdvWasm/nkdvCpp.data';
                }
                return prefix + path;
            }
        });
        
        // 加载网络（只执行一次）
        nkdvModule._load_network();
        console.log('[NKDV] Module initialized');
    }
    return nkdvModule;
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

// 手动过滤边界外的 lixels
function filterByBounds(lixelData, edgeCoords, bounds) {
    return lixelData.filter(([edgeIndex, dist_n1, dist_n2, kde_value]) => {
        const [lon, lat] = calculateLixelCoords(edgeCoords, edgeIndex, dist_n1, dist_n2);
        return lon >= bounds.lon_min && lon <= bounds.lon_max &&
               lat >= bounds.lat_min && lat <= bounds.lat_max;
    });
}

// 检查参数是否改变
function paramsChanged(vueThis) {
    const newParams = `${vueThis.NKDV.lixel}_${vueThis.NKDV.bandwidth}`;
    if (currentParams !== newParams) {
        currentParams = newParams;
        return true;
    }
    return false;
}

// 清除缓存
function clearCache() {
    fullLixelData = null;
    console.log('[NKDV] Cache cleared');
}

// 计算 NKDV（带边界裁剪 + 缓存优化）
async function compute_nkdv_with_bounds(vueThis) {
    const module = await initModule();
    const coords = await loadEdgeGeometry();
    
    // 获取当前边界
    getBounds(vueThis);
    
    // 检查参数是否改变，如果改变则清除缓存
    if (paramsChanged(vueThis)) {
        clearCache();
    }
    
    // 如果没有缓存，执行完整计算
    if (!fullLixelData) {
        console.log('[NKDV] 🔄 First time computation, caching results...');
        
        // 设置参数
        module._load_parameters(3, vueThis.NKDV.lixel, 2, vueThis.NKDV.bandwidth);
        
        // 执行计算
        const startTime = performance.now();
        const data = module.UTF8ToString(module._compute());
        const endTime = performance.now();
        console.log(`[NKDV] ⏱️  Full computation time: ${(endTime - startTime).toFixed(2)}ms`);
        
        // 解析并缓存结果
        fullLixelData = parseOutputText(data);
        console.log(`[NKDV] 💾 Cached ${fullLixelData.length} lixels`);
    } else {
        console.log('[NKDV] ⚡ Using cached data (fast path)');
    }
    
    // 过滤边界外的 lixels（使用缓存数据）
    const startFilter = performance.now();
    const filteredData = filterByBounds(fullLixelData, coords, vueThis.NKDV);
    const endFilter = performance.now();
    console.log(`[NKDV] 🔍 Filtering time: ${(endFilter - startFilter).toFixed(2)}ms`);
    console.log(`[NKDV] ✅ After filtering: ${filteredData.length} lixels in bounds`);
    
    // 构建 GeoJSON
    const geojson = buildLineGeoJson(coords, filteredData, vueThis.NKDV.lixel);
    
    return geojson;
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
                
                // 计算初始数据
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
                            'interpolate',
                            ['linear'],
                            ['get', 'density'],
                            0, '#0000ff',
                            0.2, '#00ffff',
                            0.4, '#00ff00',
                            0.6, '#ffff00',
                            0.8, '#ff8c00',
                            1.0, '#ff0000'
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

// 带防抖的更新函数
function updateMapDebounced(vueThis) {
    // 如果地图还没准备好，不触发更新
    if (!isMapReady) {
        console.log('[NKDV] Map not ready yet, skipping update');
        return;
    }
    
    if (updateTimeout) {
        clearTimeout(updateTimeout);
    }
    
    updateTimeout = setTimeout(() => {
        updateMap(vueThis);
    }, 500); // 500ms 延迟
}

// 更新地图（重新计算当前边界的 NKDV）
async function updateMap(vueThis) {
    try {
        console.log('[NKDV] Updating for new bounds...');
        
        // 检查数据源是否存在
        const source = vueThis.map.getSource('nkdv');
        if (!source) {
            console.warn('[NKDV] Source not ready yet, skipping update');
            return;
        }
        
        let geojson = await compute_nkdv_with_bounds(vueThis);
        source.setData(geojson);
        console.log('[NKDV] Update complete');
    } catch (error) {
        console.error('[NKDV] Error updating:', error);
    }
}

// 更新属性（保持兼容性）
// 当参数改变时，清除缓存并重新计算
function updateAtriibution(vueThis) {
    console.log('[NKDV] Parameters changed, clearing cache...');
    clearCache();  // 清除缓存，强制重新计算
    updateMapDebounced(vueThis);
}

export default {
    loadHeatMap,
    updateAtriibution,
    updateMap,
    getBounds,
    clearCache  // 导出清除缓存函数
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

function parseOutputText(outputText) {
    const lines = outputText.trim().split('\n');
    const numLixels = parseInt(lines[0]);
    const lixelData = [];

    for (let i = 1; i <= numLixels; i++) {
        const [edgeIndex, dist_n1, dist_n2, kde_value] = lines[i].split(/\s+/).map(Number);
        lixelData.push([edgeIndex, dist_n1, dist_n2, kde_value]);
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

function normalizeKdeValues(values, method = 'minmax') {
    // 归一化前：将小于 0 的 KDE 值设为 0
    const clippedValues = values.map(v => Math.max(v, 0));

    const arr = Float64Array.from(clippedValues);
    let normalized;

    if (method === 'sum') {
        const total = arr.reduce((a, b) => a + b, 0);
        normalized = total > 0 ? arr.map(v => v / total) : arr;
    } else if (method === 'minmax') {
        const min = Math.min(...arr);
        const max = Math.max(...arr);
        normalized = arr.map(v => (v - min) / (max - min + 1e-8));
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

function buildLineGeoJson(edgeCoords, lixelData,lixel_reg_length) {
    // 提取所有 KDE 值用于归一化
    const kdeValues = lixelData.map(item => item[3]);

    // 选择归一化方法：'sum', 'minmax', 'zscore'
    const normalizedValues = normalizeKdeValues(kdeValues, 'minmax');

    const features = [];

    // 按 edge_index 分组 lixel 数据
    const edgeLixels = {};
    lixelData.forEach((data, i) => {
        const [edgeIndex, distN1, distN2] = data;
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