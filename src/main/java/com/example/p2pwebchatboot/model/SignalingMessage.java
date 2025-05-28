package com.example.p2pwebchatboot.model;


import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;
import java.util.Map;

@JsonInclude(JsonInclude.Include.NON_NULL)
public class SignalingMessage {
    private MessageType type;
    private String userId;
    private String targetUserId;
    private String fromUserId;
    private Map<String, Object> sdp;
    private List<Map<String, Object>> candidates;
    private Map<String, Object> candidate;
    private String message;

    // 构造函数
    public SignalingMessage() {}

    public SignalingMessage(MessageType type) {
        this.type = type;
    }

    public SignalingMessage(MessageType type, String message) {
        this.type = type;
        this.message = message;
    }

    // Getter和Setter方法
    public MessageType getType() {
        return type;
    }

    public void setType(MessageType type) {
        this.type = type;
    }

    public String getUserId() {
        return userId;
    }

    public void setUserId(String userId) {
        this.userId = userId;
    }

    public String getTargetUserId() {
        return targetUserId;
    }

    public void setTargetUserId(String targetUserId) {
        this.targetUserId = targetUserId;
    }

    public String getFromUserId() {
        return fromUserId;
    }

    public void setFromUserId(String fromUserId) {
        this.fromUserId = fromUserId;
    }

    public Map<String, Object> getSdp() {
        return sdp;
    }

    public void setSdp(Map<String, Object> sdp) {
        this.sdp = sdp;
    }

    public List<Map<String, Object>> getCandidates() {
        return candidates;
    }

    public void setCandidates(List<Map<String, Object>> candidates) {
        this.candidates = candidates;
    }

    public Map<String, Object> getCandidate() {
        return candidate;
    }

    public void setCandidate(Map<String, Object> candidate) {
        this.candidate = candidate;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }
}