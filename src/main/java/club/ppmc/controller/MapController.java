/**
 * [修改]
 * 1. API基准路径已统一为 /api/v1/locations
 * 2. 新增了处理评论和点赞的API端点。
 */
package club.ppmc.controller;

import club.ppmc.dto.CommentLikeResponse;
import club.ppmc.dto.CommentRequest;
import club.ppmc.dto.LocationComment;
import club.ppmc.dto.SharedLocation;
import club.ppmc.service.MapService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.math.BigDecimal;
import java.util.List;

@RestController
@RequestMapping("/api/v1/locations") // [修改] 统一API前缀
public class MapController {

    private final MapService mapService;

    public MapController(MapService mapService) {
        this.mapService = mapService;
    }

    @GetMapping
    public ResponseEntity<List<SharedLocation>> getAllLocations() {
        List<SharedLocation> locations = mapService.getAllLocations();
        return ResponseEntity.ok(locations);
    }

    @PostMapping
    public ResponseEntity<SharedLocation> createLocation(
            @RequestParam("latitude") BigDecimal latitude,
            @RequestParam("longitude") BigDecimal longitude,
            @RequestParam("tag") String tag,
            @RequestParam("description") String description,
            @RequestParam("createdBy") String createdBy,
            @RequestParam("image") MultipartFile image
    ) {
        SharedLocation newLocation = mapService.createLocation(latitude, longitude, tag, description, createdBy, image);
        return new ResponseEntity<>(newLocation, HttpStatus.CREATED);
    }


    // --- [新增] ---

    /**
     * 获取指定地点的所有评论。
     * Endpoint: GET /api/v1/locations/{locationId}/comments
     * @param locationId 地点ID。
     * @param userId 当前用户ID (生产环境应从认证中获取)。
     * @return 评论列表。
     */
    @GetMapping("/{locationId}/comments")
    public ResponseEntity<List<LocationComment>> getCommentsForLocation(
            @PathVariable Long locationId,
            @RequestParam("userId") String userId // 生产环境警告：应从认证信息中获取
    ) {
        List<LocationComment> comments = mapService.getCommentsForLocation(locationId, userId);
        return ResponseEntity.ok(comments);
    }

    /**
     * 为指定地点添加一条新评论。
     * Endpoint: POST /api/v1/locations/{locationId}/comments
     * @param locationId 地点ID。
     * @param commentRequest 包含评论内容的请求体。
     * @return 新创建的评论。
     */
    @PostMapping("/{locationId}/comments")
    public ResponseEntity<LocationComment> addComment(
            @PathVariable Long locationId,
            @Valid @RequestBody CommentRequest commentRequest
    ) {
        LocationComment newComment = mapService.addComment(locationId, commentRequest);
        return new ResponseEntity<>(newComment, HttpStatus.CREATED);
    }

    /**
     * 对指定评论进行点赞或取消点赞。
     * Endpoint: POST /api/v1/locations/comments/{commentId}/like
     * @param commentId 评论ID。
     * @param userId    操作用户的ID (生产环境应从认证中获取)。
     * @return 最新的点赞状态和数量。
     */
    @PostMapping("/comments/{commentId}/like")
    public ResponseEntity<CommentLikeResponse> toggleLike(
            @PathVariable Long commentId,
            @RequestParam("userId") String userId // 生产环境警告：应从认证信息中获取
    ) {
        CommentLikeResponse response = mapService.toggleLike(commentId, userId);
        return ResponseEntity.ok(response);
    }
    // --- [新增结束] ---
}