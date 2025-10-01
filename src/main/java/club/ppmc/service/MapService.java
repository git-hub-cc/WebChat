/**
 * [新文件]
 * “世界地图分享”功能的核心业务逻辑服务。
 * 负责处理地点的增删改查以及关联的文件操作。
 */
package club.ppmc.service;

import club.ppmc.dto.SharedLocationDto;
import club.ppmc.exception.FileUploadException;
import club.ppmc.model.SharedLocation;
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
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class MapService {

    private static final Logger logger = LoggerFactory.getLogger(MapService.class);

    private final SharedLocationRepository locationRepository;
    private final Path uploadPath;
    // [修改] 将 publicPathPrefix 的值从 "/map-images/" 改为 "map-images/"
    private final String publicPathPrefix = "map-images/";

    public MapService(SharedLocationRepository locationRepository,
                      @Value("${file.upload-dir.map-images}") String uploadDir) {
        this.locationRepository = locationRepository;
        this.uploadPath = Paths.get(uploadDir).toAbsolutePath().normalize();
        try {
            Files.createDirectories(this.uploadPath);
        } catch (IOException e) {
            throw new FileUploadException("无法创建或访问上传目录: " + this.uploadPath, e);
        }
    }

    /**
     * 获取所有已分享的地点。
     * @return A list of SharedLocationDto objects.
     */
    @Transactional(readOnly = true)
    public List<SharedLocationDto> getAllLocations() {
        return locationRepository.findAll().stream()
                .map(SharedLocationDto::fromEntity)
                .collect(Collectors.toList());
    }

    /**
     * 创建一个新的地点分享，并处理附带的图片上传。
     *
     * @param latitude    纬度
     * @param longitude   经度
     * @param tag         标签
     * @param description 描述
     * @param createdBy   创建者用户ID
     * @param imageFile   上传的图片文件
     * @return The DTO of the newly created location.
     */
    @Transactional
    public SharedLocationDto createLocation(BigDecimal latitude, BigDecimal longitude, String tag, String description, String createdBy, MultipartFile imageFile) {
        // 1. 保存图片文件并获取其相对访问URL
        String imageUrl = saveFile(imageFile);

        // 2. 创建并保存地点实体
        SharedLocation newLocation = new SharedLocation();
        newLocation.setLatitude(latitude);
        newLocation.setLongitude(longitude);
        newLocation.setTag(tag);
        newLocation.setDescription(description);
        newLocation.setCreatedBy(createdBy);
        newLocation.setImageUrl(imageUrl);

        SharedLocation savedLocation = locationRepository.save(newLocation);
        logger.info("新地点已创建，ID: {}, 创建者: {}", savedLocation.getId(), createdBy);

        return SharedLocationDto.fromEntity(savedLocation);
    }

    /**
     * 将上传的文件保存到服务器，并返回其可公开访问的相对URL路径。
     *
     * @param file The MultipartFile to save.
     * @return The public relative URL path for the saved file.
     * @throws FileUploadException if the file is empty, invalid, or cannot be saved.
     */
    private String saveFile(MultipartFile file) {
        if (file.isEmpty()) {
            throw new FileUploadException("上传的文件不能为空。");
        }

        String originalFilename = StringUtils.cleanPath(file.getOriginalFilename());
        if (originalFilename.contains("..")) {
            throw new FileUploadException("文件名包含无效路径序列: " + originalFilename);
        }

        // 生成唯一文件名以避免冲突
        String fileExtension = StringUtils.getFilenameExtension(originalFilename);
        String uniqueFilename = UUID.randomUUID().toString() + "." + fileExtension;
        Path targetLocation = this.uploadPath.resolve(uniqueFilename);

        try (InputStream inputStream = file.getInputStream()) {
            Files.copy(inputStream, targetLocation, StandardCopyOption.REPLACE_EXISTING);
            logger.debug("文件已成功保存至: {}", targetLocation);
        } catch (IOException e) {
            throw new FileUploadException("存储文件失败: " + uniqueFilename, e);
        }

        // [修改] 返回拼接后的相对路径，不带开头的斜杠
        return publicPathPrefix + uniqueFilename;
    }
}