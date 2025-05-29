package com.example.p2pwebchatboot.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;
import java.util.Map;

@JsonInclude(JsonInclude.Include.NON_NULL) // Important: don't send null fields
public class SignalingMessage {
    private MessageType type;
    private String userId;
    private String targetUserId;
    private String fromUserId; // Set by server when forwarding

    private String sdp;        // The SDP string itself
    private String sdpType;    // "offer" or "answer"

    private List<Map<String, Object>> candidates; // For OFFER/ANSWER with multiple candidates
    private Map<String, Object> candidate;      // For single ICE_CANDIDATE

    private Boolean isVideoCall;
    private Boolean isAudioOnly;

    private String message; // For SUCCESS/ERROR types

    // Constructors
    public SignalingMessage() {}

    public SignalingMessage(MessageType type) {
        this.type = type;
    }
    public SignalingMessage(MessageType type, String message) {
        this.type = type;
        this.message = message;
    }

    // Getters and Setters for ALL fields...
    // (e.g., getType, setType, getSdp, setSdp, getSdpType, setSdpType, etc.)

    public MessageType getType() { return type; }
    public void setType(MessageType type) { this.type = type; }
    public String getUserId() { return userId; }
    public void setUserId(String userId) { this.userId = userId; }
    public String getTargetUserId() { return targetUserId; }
    public void setTargetUserId(String targetUserId) { this.targetUserId = targetUserId; }
    public String getFromUserId() { return fromUserId; }
    public void setFromUserId(String fromUserId) { this.fromUserId = fromUserId; }
    public String getSdp() { return sdp; }
    public void setSdp(String sdp) { this.sdp = sdp; }
    public String getSdpType() { return sdpType; }
    public void setSdpType(String sdpType) { this.sdpType = sdpType; }
    public List<Map<String, Object>> getCandidates() { return candidates; }
    public void setCandidates(List<Map<String, Object>> candidates) { this.candidates = candidates; }
    public Map<String, Object> getCandidate() { return candidate; }
    public void setCandidate(Map<String, Object> candidate) { this.candidate = candidate; }
    public Boolean getIsVideoCall() { return isVideoCall; } // Use getIsVideoCall for boolean
    public void setIsVideoCall(Boolean videoCall) { isVideoCall = videoCall; }
    public Boolean getIsAudioOnly() { return isAudioOnly; } // Use getIsAudioOnly for boolean
    public void setIsAudioOnly(Boolean audioOnly) { isAudioOnly = audioOnly; }
    public String getMessage() { return message; }
    public void setMessage(String message) { this.message = message; }
}