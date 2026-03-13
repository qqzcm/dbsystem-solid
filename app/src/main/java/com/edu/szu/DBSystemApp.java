package com.edu.szu;

import com.edu.szu.config.*;
import lombok.extern.log4j.Log4j2;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Import;

@Import({
        // config
        DCPGSConfig.class,
        KSTCConfig.class,
        KDVConfig.class,
        STDConfig.class,
        //PAConfig.class,

        // service
        DatasetLoader.class,

        // endpoint
        DCPGSEndpoint.class,
        KSTCEndpoint.class,
        KDVEndpoint.class,
        STDEndPoint.class,
        PAEndPoint.class,
        topkMain.class
})
@EnableConfigurationProperties(DatasetProperties.class)
@SpringBootApplication
@Log4j2
public class DBSystemApp {

    public static void main(String[] args) {
        SpringApplication.run(DBSystemApp.class, args);
    }
}

