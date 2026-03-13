package com.edu.szu.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.Map;

@Data
@ConfigurationProperties(prefix = "datasets")
public class DatasetProperties {

    private DcpgsDataset dcpgs;
    private TopkDataset topk;
    private PaDataset pa;
    private KdvDataset kdv;
    private StdDataset std;

    @Data
    public static class DcpgsDataset {
        private String resourcePath;
        private Map<String, String> checkinFiles;
        private Map<String, String> edgeFiles;
    }

    @Data
    public static class TopkDataset {
        private String basePath;
        private String eid2keyword;
        private String eid2coor;
        private String relation2id;
        private String train2id;
        private String entity;
    }

    @Data
    public static class PaDataset {
        private String basePath;
        private String targetPath;
    }

    @Data
    public static class KdvDataset {
        private String dataPath;
    }

    @Data
    public static class StdDataset {
        private String rtreePath;
        private String objsPath;
        private String ifilePath;
    }
}
