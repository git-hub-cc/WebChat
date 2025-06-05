package com.example.p2pwebchatboot.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;
import java.util.Map;

/**
 * Represents a signaling message exchanged over WebSocket for WebRTC.
 * Fields are included in JSON only if non-null to keep payloads clean.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class SignalingMessage {
    private MessageType type;       // Type of the signaling message

    // User identifiers
    private String userId;          // ID of the user sending the message (e.g., for REGISTER)
    private String targetUserId;    // ID of the recipient user (for OFFER, ANSWER, ICE_CANDIDATE)
    private String fromUserId;      // ID of the original sender, set by server when forwarding

    // WebRTC SDP (Session Description Protocol) related fields
    private String sdp;             // The SDP string (for OFFER, ANSWER)
    private String sdpType;         // Type of SDP ("offer" or "answer")

    // WebRTC ICE (Interactive Connectivity Establishment) related fields
    private List<Map<String, Object>> candidates; // For bundling multiple ICE candidates with OFFER/ANSWER
    private Map<String, Object> candidate;      // For a single ICE_CANDIDATE message

    // Call type indicators
    private Boolean isVideoCall;    // True if the call includes video
    private Boolean isAudioOnly;    // True if the call is audio-only
    private Boolean isScreenShare;  // True if screen sharing is involved

    // Generic message field
    private String message;         // For SUCCESS, ERROR, or other informational messages

    // Constructors
    public SignalingMessage() {}

    public SignalingMessage(MessageType type) {
        this.type = type;
    }

    public SignalingMessage(MessageType type, String message) {
        this.type = type;
        this.message = message;
    }

    // Getters and Setters
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

    public Boolean getIsVideoCall() { return isVideoCall; }
    public void setIsVideoCall(Boolean videoCall) { isVideoCall = videoCall; }

    public Boolean getIsAudioOnly() { return isAudioOnly; }
    public void setIsAudioOnly(Boolean audioOnly) { isAudioOnly = audioOnly; }

    public Boolean getIsScreenShare() { return isScreenShare; }
    public void setIsScreenShare(Boolean screenShare) { isScreenShare = screenShare; }

    public String getMessage() { return message; }
    public void setMessage(String message) { this.message = message; }

    @Override
    public String toString() { // For logging non-sensitive parts of the message
        return "SignalingMessage{" +
                "type=" + type +
                (userId != null ? ", userId='" + userId + '\'' : "") +
                (targetUserId != null ? ", targetUserId='" + targetUserId + '\'' : "") +
                (fromUserId != null ? ", fromUserId='" + fromUserId + '\'' : "") +
                (sdp != null ? ", sdp='<present>'" : "") + // Avoid logging full SDP
                (sdpType != null ? ", sdpType='" + sdpType + '\'' : "") +
                (candidates != null ? ", candidatesCount=" + candidates.size() : "") +
                (candidate != null ? ", candidate='<present>'" : "") + // Avoid logging full candidate
                (isVideoCall != null ? ", isVideoCall=" + isVideoCall : "") +
                (isAudioOnly != null ? ", isAudioOnly=" + isAudioOnly : "") +
                (isScreenShare != null ? ", isScreenShare=" + isScreenShare : "") +
                (message != null ? ", message='" + message + '\'' : "") +
                '}';
    }
}