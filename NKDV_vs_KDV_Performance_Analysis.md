# NKDV vs KDV 性能差异分析

## 一、算法复杂度对比

### KDV 算法
- **计算模式**：基于规则的 2D 网格
- **计算单元**：网格像素（`row_pixels × col_pixels`）
- **距离计算**：欧几里得距离（直接计算）
- **时间复杂度**：`O(row_pixels × col_pixels × n_points)`
- **空间复杂度**：`O(row_pixels × col_pixels)`

### NKDV 算法
- **计算模式**：基于网络边（edges）和 lixel（网络上的离散单元）
- **计算单元**：Lixel（每条边上的多个离散点）
- **距离计算**：网络距离（需要最短路径算法）
- **时间复杂度**：`O(num_lixels × (V log V + E + m × n_points))`
  - `V`: 网络节点数
  - `E`: 网络边数
  - `m`: 边数
  - `num_lixels`: Lixel 数量（通常远大于网格像素数）
- **空间复杂度**：`O(V + E + num_lixels)`

## 二、主要性能瓶颈

### 1. **Dijkstra 最短路径算法（最大瓶颈）**

**NKDV 中的使用**：
```cpp
// 在 alg_NKDV.cpp 中，每个 lixel 都需要运行 Dijkstra
for (int l = 0; l < (int)our_model.lixel_set.size(); l++) {
    dijkstra(our_model);  // O(V log V + E)
    NKDV_basic(our_model); // O(m × n_points)
}
```

**复杂度分析**：
- 每个 lixel 运行一次 Dijkstra：`O(V log V + E)`
- 如果有 `L` 个 lixels，总复杂度：`O(L × (V log V + E))`
- 对于大型网络（如数千个节点和边），这是非常昂贵的操作

**KDV 对比**：
- KDV 不需要最短路径计算
- 直接使用欧几里得距离：`O(1)` 计算

### 2. **Lixel 数量远大于网格像素数**

**NKDV**：
- Lixel 数量 = 所有边的长度总和 / `lixel_reg_length`
- 对于密集网络，lixel 数量可能达到数万甚至数十万
- 例如：1000 条边，每条边平均 100 米，lixel 长度 50 米 → 约 2000 个 lixels

**KDV**：
- 网格像素数 = `row_pixels × col_pixels`
- 通常设置为 16×16 到 256×256（256 到 65,536 个像素）
- 数量可控且相对固定

### 3. **网络距离计算 vs 欧几里得距离**

**NKDV**：
- 需要计算网络距离（沿网络路径的距离）
- 每个点对每个 lixel 的距离计算需要：
  1. 找到点所在的边
  2. 计算点到 lixel 的网络距离（可能经过多条边）
  3. 应用核函数

**KDV**：
- 直接计算欧几里得距离：`sqrt((x1-x2)² + (y1-y2)²)`
- 计算简单快速

### 4. **前端数据处理开销**

**NKDV 额外步骤**：
1. **加载边几何**：`loadEdgeGeometry()` - 需要读取和解析 CSV
2. **边界过滤**：`filterByBounds()` - 遍历所有 lixel 数据，计算坐标
3. **时间过滤**（时空模式）：`filterByTime()` - 额外的过滤步骤
4. **构建 GeoJSON**：`buildLineGeoJson()` - 需要：
   - 按边分组 lixels
   - 排序 lixels
   - 计算每个 lixel 的坐标
   - 构建 LineString 特征
5. **归一化**：`normalizeKdeValues()` - 使用百分位数计算（如果启用）

**KDV 处理**：
1. 直接使用 WASM 返回的网格数据
2. 简单的归一化（min-max）
3. 构建矩形 GeoJSON（相对简单）

## 三、具体耗时分布（估算）

### NKDV 耗时分布（假设 1000 个 lixels，1000 个节点，2000 个边，1000 个点）：

1. **Dijkstra 算法**：~60-70%
   - 1000 个 lixels × Dijkstra(1000 节点) ≈ 1000 × (1000 × log(1000)) ≈ 10,000,000 次操作

2. **KDE 计算**：~20-25%
   - 1000 个 lixels × 2000 条边 × 1000 个点 ≈ 2,000,000,000 次距离计算

3. **网络裁剪和重索引**：~5%
   - `clip_network_by_bounds()`, `clip_points_by_bounds()`, `reindex_network()`

4. **前端处理**：~5-10%
   - 数据解析、过滤、GeoJSON 构建

### KDV 耗时分布（假设 16×16 网格，1000 个点）：

1. **KDE 计算**：~90-95%
   - 256 个像素 × 1000 个点 ≈ 256,000 次距离计算

2. **前端处理**：~5-10%
   - 数据解析、归一化、GeoJSON 构建

## 四、优化建议

### 针对 NKDV 的优化：

1. **减少 Dijkstra 调用次数**
   - 使用缓存：相同边的 lixels 共享 Dijkstra 结果
   - 使用优化方法（method >= 2）：只在边改变时运行 Dijkstra

2. **减少 Lixel 数量**
   - 增大 `lixel_reg_length`（如果精度允许）
   - 只计算可见区域的 lixels

3. **空间裁剪优化**
   - 在 C++ 端进行裁剪（已实现）
   - 减少需要计算的节点和边数

4. **前端优化**
   - 使用 Web Worker 进行数据处理
   - 优化 `filterByBounds` 和 `buildLineGeoJson`（已部分优化）
   - 使用 `Float64Array` 和批量操作

5. **预计算和缓存**
   - 时空模式下预计算所有时间点（已实现）
   - 缓存边界内的计算结果

## 五、总结

**NKDV 比 KDV 慢的主要原因**：

1. **算法本质差异**：
   - NKDV 需要网络距离计算（Dijkstra），KDV 只需要欧几里得距离
   - NKDV 的计算单元（lixel）数量通常远大于 KDV 的网格像素数

2. **计算复杂度**：
   - NKDV: `O(L × (V log V + E + m × n))`，其中 L 可能很大
   - KDV: `O(P × n)`，其中 P 是固定的网格像素数

3. **实际性能差异**：
   - 对于相同的数据集，NKDV 可能比 KDV 慢 **10-100 倍**，具体取决于：
     - 网络规模（节点数、边数）
     - Lixel 密度
     - 数据点数量

**这是算法特性决定的，不是实现问题**。NKDV 提供了更准确的网络空间分析，但代价是更高的计算成本。
