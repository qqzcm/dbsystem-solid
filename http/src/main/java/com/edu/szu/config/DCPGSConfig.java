package com.edu.szu.config;

import com.edu.szu.DCPGSManager;
import com.edu.szu.util.EdgeReader;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

@Configuration
public class DCPGSConfig {

    @Bean
    public DCPGSManager dcpgsManager(DatasetProperties datasetProperties) throws IOException {
        var dcpgsProps = datasetProperties.getDcpgs();
        var dcpgsManager = new DCPGSManager(dcpgsProps.getResourcePath());
        Map<String, Map<Long, Set<Long>>> edgeMapSet = new HashMap<>();
        for (var entry : dcpgsProps.getEdgeFiles().entrySet()) {
            var edgeMap = EdgeReader.getEdges(dcpgsProps.getResourcePath() + entry.getValue());
            edgeMapSet.put(entry.getKey(), edgeMap);
        }
        dcpgsManager.setEdgeMapSet(edgeMapSet);
        return dcpgsManager;
    }
}
