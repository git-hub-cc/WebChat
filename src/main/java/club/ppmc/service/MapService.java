/**
 * [修改]
 * 新增了评论和点赞相关的业务逻辑。
 */
package club.ppmc.service;

import club.ppmc.dto.CommentLikeResponse;
import club.ppmc.dto.CommentRequest;
import club.ppmc.dto.LocationComment;
import club.ppmc.dto.SharedLocation;
import club.ppmc.exception.FileUploadException;
import club.ppmc.exception.ResourceNotFoundException;
import club.ppmc.model.CommentLike;
import club.ppmc.repository.CommentLikeRepository;
import club.ppmc.repository.LocationCommentRepository;
import club.ppmc.repository.SharedLocationRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class MapService {

    private static final Logger logger = LoggerFactory.getLogger(MapService.class);

    private final SharedLocationRepository locationRepository;
    private final LocationCommentRepository commentRepository; // [新增]
    private final CommentLikeRepository likeRepository; // [新增]
    private final Path uploadPath;
    private final String publicPathPrefix = "map-images/";

    public MapService(SharedLocationRepository locationRepository,
                      LocationCommentRepository commentRepository, // [新增]
                      CommentLikeRepository likeRepository,       // [新增]
                      @Value("${file.upload-dir.map-images}") String uploadDir) {
        this.locationRepository = locationRepository;
        this.commentRepository = commentRepository; // [新增]
        this.likeRepository = likeRepository;       // [新增]
        this.uploadPath = Paths.get(uploadDir).toAbsolutePath().normalize();
        try {
            Files.createDirectories(this.uploadPath);
        } catch (IOException e) {
            throw new FileUploadException("无法创建或访问上传目录: " + this.uploadPath, e);
        }
    }

    @Transactional(readOnly = true)
    public List<SharedLocation> getAllLocations() {
        return locationRepository.findAll().stream()
                .map(SharedLocation::fromEntity)
                .collect(Collectors.toList());
    }

    @Transactional
    public SharedLocation createLocation(BigDecimal latitude, BigDecimal longitude, String tag, String description, String createdBy, MultipartFile imageFile) {
        String imageUrl = saveFile(imageFile);
        club.ppmc.model.SharedLocation newLocation = new club.ppmc.model.SharedLocation();
        newLocation.setLatitude(latitude);
        newLocation.setLongitude(longitude);
        newLocation.setTag(tag);
        newLocation.setDescription(description);
        newLocation.setCreatedBy(createdBy);
        newLocation.setImageUrl(imageUrl);
        club.ppmc.model.SharedLocation savedLocation = locationRepository.save(newLocation);
        logger.info("新地点已创建，ID: {}, 创建者: {}", savedLocation.getId(), createdBy);
        return SharedLocation.fromEntity(savedLocation);
    }

    private String saveFile(MultipartFile file) {
        if (file.isEmpty()) throw new FileUploadException("上传的文件不能为空。");
        String originalFilename = StringUtils.cleanPath(file.getOriginalFilename());
        if (originalFilename.contains("..")) throw new FileUploadException("文件名包含无效路径序列: " + originalFilename);
        String fileExtension = StringUtils.getFilenameExtension(originalFilename);
        String uniqueFilename = UUID.randomUUID().toString() + "." + fileExtension;
        Path targetLocation = this.uploadPath.resolve(uniqueFilename);
        try (InputStream inputStream = file.getInputStream()) {
            Files.copy(inputStream, targetLocation, StandardCopyOption.REPLACE_EXISTING);
            logger.debug("文件已成功保存至: {}", targetLocation);
        } catch (IOException e) {
            throw new FileUploadException("存储文件失败: " + uniqueFilename, e);
        }
        return publicPathPrefix + uniqueFilename;
    }

    // --- [新增] ---

    /**
     * 获取指定地点的所有评论。
     * @param locationId 地点ID。
     * @param currentUserId 当前请求的用户ID，用于判断是否已点赞。
     * @return 评论DTO列表。
     */
    @Transactional(readOnly = true)
    public List<LocationComment> getCommentsForLocation(Long locationId, String currentUserId) {
        if (!locationRepository.existsById(locationId)) {
            throw new ResourceNotFoundException("地点未找到，ID: " + locationId);
        }
        List<club.ppmc.model.LocationComment> comments = commentRepository.findByLocationIdOrderByCreatedAtDesc(locationId);
        return comments.stream()
                .map(comment -> new LocationComment(
                        comment.getId(),
                        comment.getContent(),
                        comment.getUserId(),
                        comment.getCreatedAt(),
                        likeRepository.countByComment(comment),
                        likeRepository.findByCommentAndUserId(comment, currentUserId).isPresent()
                ))
                .collect(Collectors.toList());
    }

    /**
     * 为指定地点添加一条新评论。
     * @param locationId 地点ID。
     * @param commentRequest 包含评论内容和用户ID的请求体。
     * @return 新创建的评论DTO。
     */
    @Transactional
    public LocationComment addComment(Long locationId, CommentRequest commentRequest) {
        club.ppmc.model.SharedLocation location = locationRepository.findById(locationId)
                .orElseThrow(() -> new ResourceNotFoundException("地点未找到，ID: " + locationId));

        club.ppmc.model.LocationComment newComment = new club.ppmc.model.LocationComment();
        newComment.setLocation(location);
        newComment.setContent(commentRequest.content());
        newComment.setUserId(commentRequest.userId());

        club.ppmc.model.LocationComment savedComment = commentRepository.save(newComment);
        logger.info("新评论已添加至地点ID {}, 评论ID: {}", locationId, savedComment.getId());

        return new LocationComment(
                savedComment.getId(),
                savedComment.getContent(),
                savedComment.getUserId(),
                savedComment.getCreatedAt(),
                0, // 新评论点赞数为0
                false // 新评论当前用户未点赞
        );
    }

    /**
     * 处理对评论的点赞或取消点赞操作。
     * @param commentId 评论ID。
     * @param userId 操作用户的ID。
     * @return 包含最新点赞数和用户点赞状态的响应对象。
     */
    @Transactional
    public CommentLikeResponse toggleLike(Long commentId, String userId) {
        club.ppmc.model.LocationComment comment = commentRepository.findById(commentId)
                .orElseThrow(() -> new ResourceNotFoundException("评论未找到，ID: " + commentId));

        Optional<CommentLike> existingLike = likeRepository.findByCommentAndUserId(comment, userId);

        if (existingLike.isPresent()) {
            // 已点赞，取消点赞
            likeRepository.delete(existingLike.get());
            logger.debug("用户 {} 取消了对评论 {} 的点赞", userId, commentId);
        } else {
            // 未点赞，添加点赞
            CommentLike newLike = new CommentLike(comment, userId);
            likeRepository.save(newLike);
            logger.debug("用户 {} 点赞了评论 {}", userId, commentId);
        }

        long newLikeCount = likeRepository.countByComment(comment);
        boolean likedByCurrentUser = !existingLike.isPresent();

        return new CommentLikeResponse(newLikeCount, likedByCurrentUser);
    }
    // --- [新增结束] ---
}