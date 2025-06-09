package com.p2pChat.model;

/**
 * Enumerates the types of signaling messages used in WebSocket communication.
 */
public enum MessageType {
    REGISTER,       // Client registers with a user ID
    OFFER,          // WebRTC offer message
    ANSWER,         // WebRTC answer message
    ICE_CANDIDATE,  // WebRTC ICE candidate
    ERROR,          // Error message from server to client
    USER_NOT_FOUND, // Indicates target user for a message was not found
    SUCCESS         // Generic success message from server to client
}