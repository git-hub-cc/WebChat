package com.example.p2pwebchatboot.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.LocalDate;

/**
 * Stores rate limiting information for a client.
 * Includes the request count and the date for which the count is valid.
 */
@JsonInclude(JsonInclude.Include.NON_NULL) // Not strictly necessary here, but good practice for DTOs
public class RateLimitInfo {
    private int count;
    private final LocalDate date; // The date this count applies to

    public RateLimitInfo(int count, LocalDate date) {
        this.count = count;
        this.date = date;
    }

    public int getCount() {
        return count;
    }

    public LocalDate getDate() {
        return date;
    }

    public void incrementCount() {
        this.count++;
    }
}