package club.ppmc;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Main entry point for the P2P WebChat Spring Boot application.
 * This class initializes and launches the Spring application context.
 */
@SpringBootApplication
@EnableScheduling
public class BootApplication {

    /**
     * The main method that serves as the application's entry point.
     * @param args Command line arguments passed to the application.
     */
    public static void main(String[] args) {
        SpringApplication.run(BootApplication.class, args);
    }

}