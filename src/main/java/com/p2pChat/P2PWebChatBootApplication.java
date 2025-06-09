package com.p2pChat;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Main entry point for the P2P WebChat Spring Boot application.
 * This class initializes and launches the Spring application context.
 */
@SpringBootApplication
public class P2PWebChatBootApplication {

    /**
     * The main method that serves as the application's entry point.
     * @param args Command line arguments passed to the application.
     */
    public static void main(String[] args) {
        SpringApplication.run(P2PWebChatBootApplication.class, args);
    }

}