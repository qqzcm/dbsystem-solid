package com.edu.szu.config;

import org.apache.commons.io.IOUtils;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.List;

@Service
public class DatasetLoader {

    /**
     * Load raw bytes from a classpath resource.
     */
    public byte[] loadFromClasspath(String path) throws IOException {
        try (InputStream is = resolveResource(path)) {
            return IOUtils.toByteArray(is);
        }
    }

    /**
     * Load all lines from a classpath resource.
     */
    public List<String> loadLinesFromClasspath(String path) throws IOException {
        try (InputStream is = resolveResource(path)) {
            return IOUtils.readLines(is, StandardCharsets.UTF_8);
        }
    }

    /**
     * Open a BufferedReader for the given path (classpath: or filesystem).
     * Caller is responsible for closing.
     */
    public BufferedReader loadReader(String path) throws IOException {
        return new BufferedReader(new InputStreamReader(resolveResource(path), StandardCharsets.UTF_8));
    }

    /**
     * Resolve a path to an InputStream. Supports "classpath:" prefix for classpath
     * resources, otherwise treats as a filesystem path.
     * Caller is responsible for closing the returned stream.
     */
    public InputStream resolveResource(String path) throws IOException {
        Resource resource;
        if (path.startsWith("classpath:")) {
            String classpathLocation = path.substring("classpath:".length());
            resource = new ClassPathResource(classpathLocation);
        } else {
            resource = new FileSystemResource(path);
        }
        return resource.getInputStream();
    }
}
