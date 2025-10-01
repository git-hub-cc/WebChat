/**
 * [新文件]
 * 用于“世界地图分享”功能的数据传输对象 (DTO)。
 * 这是一个不可变的 `record` 类型，用于在API层面安全地传输地点数据。
 */
package club.ppmc.dto;

import club.ppmc.model.SharedLocation;
import java.math.BigDecimal;
import java.time.LocalDateTime;

public record SharedLocationDto(
        Long id,
        BigDecimal latitude,
        BigDecimal longitude,
        String tag,
        String description,
        String imageUrl,
        String createdBy,
        LocalDateTime createdAt
) {
    /**
     * 工厂方法，用于从JPA实体对象轻松创建DTO。
     * @param entity The SharedLocation entity from the database.
     * @return A new SharedLocationDto instance.
     */
    public static SharedLocationDto fromEntity(SharedLocation entity) {
        return new SharedLocationDto(
                entity.getId(),
                entity.getLatitude(),
                entity.getLongitude(),
                entity.getTag(),
                entity.getDescription(),
                entity.getImageUrl(),
                entity.getCreatedBy(),
                entity.getCreatedAt()
        );
    }
}