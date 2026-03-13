package com.edu.szu;

import com.edu.szu.config.DatasetProperties;
import com.edu.szu.entity.PAGeoJson;
import com.edu.szu.entity.PAJson;
import com.edu.szu.entity.CheckInJson;

import org.springframework.web.bind.annotation.*;

import lombok.extern.log4j.Log4j2;

/**
 * @author 86136 Email:a@wk2.cn
 * @since 2024/03/18 20:56
 */
@Log4j2
@RestController
@RequestMapping("/data/pa")
public class PAEndPoint {
    private final ConvergeManager manager =new ConvergeManager();

    private final PAGeoJson paGeoJson =new PAGeoJson();

    private final PAJson clusters =new PAJson();

    private final String basePath;
    private final String targetPath;

    public PAEndPoint(DatasetProperties datasetProperties){
        this.basePath = datasetProperties.getPa().getBasePath();
        this.targetPath = datasetProperties.getPa().getTargetPath();
    }

    @PostMapping("/{inputPath}/runpa")
    public String paRun(@PathVariable String inputPath) throws Exception {
        var outputPath=basePath;
        var dataPath=basePath+inputPath;
        manager.function(dataPath, outputPath);
        log.info("runpa");
        return "run over";
    }

    @PostMapping("/geojson/{dataset}")
    public String getGeoJson(@PathVariable String dataset) throws Exception{
        log.info("getGeoJson dataset:"+dataset);
        var jsonPath=basePath+dataset;
        var result=paGeoJson.getGeojson(jsonPath,dataset,targetPath+dataset);
        return result;
    }

    @GetMapping("/cluster/{dataset}")
    public CheckInJson getCluster(@PathVariable String dataset)throws Exception{
        log.info("getJson dataset:"+dataset);
        var jsonPath=basePath+dataset;
        return clusters.readJsonFile(jsonPath);
    }
}