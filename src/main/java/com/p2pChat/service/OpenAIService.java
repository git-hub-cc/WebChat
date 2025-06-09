// PATH: src/main/java/com/p2pChat/service/OpenAIService.java
package com.p2pChat.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Service to handle business logic related to OpenAI requests,
 * such as storing request history.
 */
@Service
public class OpenAIService {

    private static final Logger logger = LoggerFactory.getLogger(OpenAIService.class);

    // A map to store the last request body string for a given user and character combination.
    // Using ConcurrentHashMap for thread safety.
    private final Map<String, String> lastRequestBodyByUserAndChar = new ConcurrentHashMap<>();

    /**
     * Stores the last request body for a specific user and character ID.
     * If an entry for the same user and character already exists, it will be overwritten.
     *
     * @param user        The user ID from the request.
     * @param characterId The character ID from the request.
     * @param requestBody The full JSON string of the request body.
     */
    public void storeLastRequest(String user, String characterId, String requestBody) {
        if (user == null || user.isEmpty() || characterId == null || characterId.isEmpty()) {
            logger.warn("Attempted to store request with missing user ('{}') or characterId ('{}'). Skipping.", user, characterId);
            return;
        }
        // Create a unique key by combining user and character ID.
        String key = user + "::" + characterId;
        System.out.println("key: " + key);
        System.out.println("requestBody: " + requestBody);
        lastRequestBodyByUserAndChar.put(key, requestBody);
        logger.info("Stored/Updated last request body for key: [{}]. Body size: {} bytes.", key, requestBody.length());
    }

    /**
     * Retrieves the last stored request body for a given user and character ID.
     * (Optional method, can be useful for debugging or other features).
     *
     * @param user        The user ID.
     * @param characterId The character ID.
     * @return The last stored request body string, or null if not found.
     */
    public String getLastRequest(String user, String characterId) {
        String key = user + "::" + characterId;
        return lastRequestBodyByUserAndChar.get(key);
    }
}