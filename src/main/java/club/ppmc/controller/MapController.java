/**
 * [新文件]
 * “世界地图分享”功能的REST API控制器。
 * 提供了获取所有地点和创建新地点的端点。
 */
package club.ppmc.controller;

import club.ppmc.dto.SharedLocationDto;
import club.ppmc.service.MapService;
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

    /**
     * 获取所有已分享的地理位置标记点。
     * @return A list of all shared locations.
     */
    @GetMapping("/locations")
    public ResponseEntity<List<SharedLocationDto>> getAllLocations() {
        List<SharedLocationDto> locations = mapService.getAllLocations();
        return ResponseEntity.ok(locations);
    }

    /**
     * 创建一个新的地理位置分享。
     * 接收 multipart/form-data 格式的请求，包含地点信息和一张图片。
     *
     * @param latitude    地点的纬度。
     * @param longitude   地点的经度。
     * @param tag         地点的标签（如“美食”）。
     * @param description 用户对地点的描述。
     * @param createdBy   分享者的用户ID。**注意：在生产环境中，此ID应从安全上下文中获取，而不是由客户端直接提供。**
     * @param image       上传的图片文件。
     * @return The newly created location data with an HTTP 201 Created status.
     */
    @PostMapping("/locations")
    public ResponseEntity<SharedLocationDto> createLocation(
            @RequestParam("latitude") BigDecimal latitude,
            @RequestParam("longitude") BigDecimal longitude,
            @RequestParam("tag") String tag,
            @RequestParam("description") String description,
            @RequestParam("createdBy") String createdBy, // 生产环境警告：应通过认证获取
            @RequestParam("image") MultipartFile image
    ) {
        SharedLocationDto newLocation = mapService.createLocation(latitude, longitude, tag, description, createdBy, image);
        return new ResponseEntity<>(newLocation, HttpStatus.CREATED);
    }
}