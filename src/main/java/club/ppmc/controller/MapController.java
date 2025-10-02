/**
 * [修改]
 * 新增了处理评论和点赞的API端点。
 */
package club.ppmc.controller;

import club.ppmc.dto.CommentLikeResponse;
import club.ppmc.dto.CommentRequest;
import club.ppmc.dto.LocationCommentDto;
import club.ppmc.dto.SharedLocationDto;
import club.ppmc.service.MapService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.math.BigDecimal;
import java.util.List;

@RestController
@RequestMapping("/api/map")
public class MapController {

    private final MapService mapService;

    public MapController(MapService mapService) {
        this.mapService = mapService;
    }

    @GetMapping("/locations")
    public ResponseEntity<List<SharedLocationDto>> getAllLocations() {
        List<SharedLocationDto> locations = mapService.getAllLocations();
        return ResponseEntity.ok(locations);
    }

    @PostMapping("/locations")
    public ResponseEntity<SharedLocationDto> createLocation(
            @RequestParam("latitude") BigDecimal latitude,
            @RequestParam("longitude") BigDecimal longitude,
            @RequestParam("tag") String tag,
            @RequestParam("description") String description,
            @RequestParam("createdBy") String createdBy,
            @RequestParam("image") MultipartFile image
    ) {
        SharedLocationDto newLocation = mapService.createLocation(latitude, longitude, tag, description, createdBy, image);
        return new ResponseEntity<>(newLocation, HttpStatus.CREATED);
    }


    // --- [新增] ---

    /**
     * 获取指定地点的所有评论。
     * @param locationId 地点ID。
     * @param userId 当前用户ID (生产环境应从认证中获取)。
     * @return 评论列表。
     */
    @GetMapping("/locations/{locationId}/comments")
    public ResponseEntity<List<LocationCommentDto>> getCommentsForLocation(
            @PathVariable Long locationId,
            @RequestParam("userId") String userId // 生产环境警告：应从认证信息中获取
    ) {
        List<LocationCommentDto> comments = mapService.getCommentsForLocation(locationId, userId);
        return ResponseEntity.ok(comments);
    }

    /**
     * 为指定地点添加一条新评论。
     * @param locationId 地点ID。
     * @param commentRequest 包含评论内容的请求体。
     * @return 新创建的评论。
     */
    @PostMapping("/locations/{locationId}/comments")
    public ResponseEntity<LocationCommentDto> addComment(
            @PathVariable Long locationId,
            @Valid @RequestBody CommentRequest commentRequest
    ) {
        LocationCommentDto newComment = mapService.addComment(locationId, commentRequest);
        return new ResponseEntity<>(newComment, HttpStatus.CREATED);
    }

    /**
     * 对指定评论进行点赞或取消点赞。
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