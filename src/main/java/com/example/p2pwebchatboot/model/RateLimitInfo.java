package com.example.p2pwebchatboot.model;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.LocalDate;

@JsonInclude(JsonInclude.Include.NON_NULL)
public class RateLimitInfo {
    private int count;
    private final LocalDate date; // 记录当前计数是哪一天的

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